#!/usr/bin/env node
/**
 * 本机联机自检：不开 DSH，直接用两个 service 实例 + 真 relay + 假 dsh-pet 跑通
 * 「配对 → presence → 互动 → 对方本机动作」全链路，并把每一步打印出来。
 *
 * 用法：node scripts/selfcheck.mjs
 * 退出码 0 = 全链路 OK；1 = 有一步失败。
 */

import http from 'node:http'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOnlineService } from '../lib/service.js'
import { createRelayServer } from '../relay/server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

function step(name) {
  console.log('▶ ' + name)
}
function ok(detail = '') {
  console.log('  ✓ ' + detail)
}
function bad(detail) {
  failures += 1
  console.log('  ✗ ' + detail)
}

async function waitUntil(fn, timeoutMs = 8000, stepMs = 100) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (value) return value
    await sleep(stepMs)
  }
  return null
}

function fakePetServer(name) {
  const calls = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://pet.local')
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/dsh-pet-7340/state') {
      const since = url.searchParams.get('since')
      if (since !== null) {
        setTimeout(() => send({ ok: true, counter: 1, sections: {}, pets: {} }), 200)
        return
      }
      return send({ ok: true, counter: 1, sections: {}, pets: {} })
    }
    if (url.pathname === '/dsh-pet-7340/config') {
      return send({
        ok: true,
        main: {
          pets: [{ id: 'main', name, size: 462, display: 'web' }],
          animations: { clicks: ['点击回应-开心跃动'], categories: [{ id: '吃什么', actions: ['吃白饭'] }], idle: ['待机呼吸休闲'] },
        },
      })
    }
    calls.push(url.pathname)
    req.on('data', () => {})
    req.on('end', () => send({ ok: true }))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, calls, origin: `http://127.0.0.1:${server.address().port}` }),
    )
  })
}

function fakeCtx(origin) {
  return {
    webServer: { getOrigin: () => origin, register: () => () => {} },
    effect(fn) {
      fn()
      return () => {}
    },
    logger: { info() {}, warn() {}, error() {} },
  }
}

async function makeService(home, origin, nickname, relayUrl) {
  process.env.DSH_HOME = home
  await mkdir(join(home, 'dsh-pet-online'), { recursive: true })
  await writeFile(join(home, 'dsh-pet-online', 'config.json'), JSON.stringify({ enabled: true, updateCheck: false }), 'utf8')
  const service = createOnlineService(fakeCtx(origin))
  service.start()
  await waitUntil(() => service.deviceId !== '')
  await service.setConfig({ relayUrl, enabled: true, nickname })
  return service
}

async function main() {
  step('启动 relay')
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`
  ok(relayUrl)

  step('启动两个假 dsh-pet + 两个联机实例')
  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const homeA = await mkdtemp(join(tmpdir(), 'dpo-self-a-'))
  const homeB = await mkdtemp(join(tmpdir(), 'dpo-self-b-'))
  const a = await makeService(homeA, petA.origin, 'A', relayUrl)
  const b = await makeService(homeB, petB.origin, 'B', relayUrl)
  ok('实例 A=' + a.deviceId + '，实例 B=' + b.deviceId)

  step('双方输入同一配对码')
  await a.pair('TEST23')
  await b.pair('TEST23')
  const online = await waitUntil(
    () => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online',
  )
  if (online) ok('relay 已连接：' + a.snapshot().relay.room)
  else bad('relay 未连上：A=' + a.snapshot().relay.status + ' B=' + b.snapshot().relay.status)

  step('等待 presence 互相可见')
  const peerB = await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))
  if (peerB) ok('A 看到 B（' + peerB.name + '）')
  else bad('A 没看到 B')

  step('A 向 B 打招呼')
  const result = await a.interact({ to: b.deviceId, intent: 'wave' })
  if (result.ok) ok('互动帧已发出 ' + result.msgId)
  else bad('互动发送失败：' + JSON.stringify(result))

  step('检查 B 的本机 dsh-pet 是否真的收到动画 + 气泡调用')
  const anim = await waitUntil(() => petB.calls.includes('/dsh-pet-7340/anim'))
  const broadcast = await waitUntil(() => petB.calls.includes('/dsh-pet-7340/broadcast'))
  if (anim) ok('B 收到 /anim')
  else bad('B 没收到 /anim')
  if (broadcast) ok('B 收到 /broadcast')
  else bad('B 没收到 /broadcast')

  step('检查回执')
  const reaction = await waitUntil(() => a.snapshot().reactions.find((r) => r.msgId === result.msgId))
  if (reaction) ok('回执：ok=' + reaction.ok + ' mode=' + (reaction.mode || 'full'))
  else bad('没收到回执')

  a.stop()
  b.stop()
  for (const pet of [petA, petB]) {
    pet.server.closeAllConnections?.()
    await new Promise((r) => pet.server.close(r))
  }
  relay.closeAllConnections?.()
  await new Promise((r) => relay.close(r))

  console.log(failures === 0 ? '\n✅ 全链路 OK' : `\n❌ ${failures} 处失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('自检异常：', error)
  process.exitCode = 1
})

