#!/usr/bin/env node
/**
 * 真机联调自检：用当前代码起一个联机实例，直接对接真实运行中的 dsh-pet（默认 62142），
 * 再模拟第二台设备连同一个 relay 房间，走完「在线 → 留言 → 回执」。
 *
 * 不需要重启 DSH，也不经过运行中插件的旧代码；验证的是 lib/ 里最新的逻辑。
 * 会在你的桌宠上弹一条气泡（留言），属于预期效果。
 *
 * 用法：
 *   node scripts/livecheck.mjs [--port 62142] [--relay ws://127.0.0.1:7420/ws]
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOnlineService } from '../lib/service.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const log = (line) => console.log(line)
const ok = (d = '') => log('  ✓ ' + d)
const bad = (d) => {
  failures += 1
  log('  ✗ ' + d)
}

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback
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

function connectPeer(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const frames = []
    ws.onmessage = (event) => {
      try {
        frames.push(JSON.parse(String(event.data)))
      } catch {
        /* ignore */
      }
    }
    ws.onerror = (event) => reject(new Error('peer ws error: ' + (event?.message ?? 'unknown')))
    ws.onopen = () =>
      resolve({
        ws,
        frames,
        send: (value) => ws.send(JSON.stringify(value)),
        wait: (predicate, timeoutMs = 5000) =>
          waitUntil(() => frames.find(predicate), timeoutMs, 50).then((hit) => hit ?? null),
      })
  })
}

async function main() {
  const port = arg('port', '62142')
  const relayUrl = arg('relay', 'ws://127.0.0.1:7420/ws')
  const origin = `http://127.0.0.1:${port}`
  const home = await mkdtemp(join(tmpdir(), 'dpo-live-'))
  process.env.DSH_HOME = home
  await mkdir(join(home, 'dsh-pet-online'), { recursive: true })
  await writeFile(join(home, 'dsh-pet-online', 'config.json'), JSON.stringify({ enabled: true }), 'utf8')

  log('▶ 用新代码起联机实例，对接真实 dsh-pet @ ' + origin)
  const service = createOnlineService({
    webServer: { getOrigin: () => origin, register: () => () => {} },
    effect(fn) {
      fn()
      return () => {}
    },
    logger: { info() {}, warn() {}, error() {} },
  })
  service.start()
  const deviceId = await waitUntil(() => (service.deviceId !== '' ? service.deviceId : null))
  if (!deviceId) bad('拿不到 deviceId')
  else ok('device=' + deviceId)

  await service.setConfig({ relayUrl, enabled: true, nickname: '真机自检' })
  const code = 'LV2345'
  const paired = await service.pair(code)
  if (paired.ok) ok('配对房间 ' + paired.room)
  else bad('配对失败：' + JSON.stringify(paired))

  log('▶ 模拟第二台设备加入同一房间')
  const peer = await connectPeer(relayUrl + '?room=pair:' + code)
  peer.send({ v: 1, type: 'hello', payload: { deviceId: 'dev-livepeer1', name: '自检伙伴', pet: 'main' } })
  const welcome = await peer.wait((f) => f.type === 'welcome')
  if (welcome) ok('peer 收到 welcome（房间内 ' + welcome.payload.peers.length + ' 台）')
  else bad('peer 没收到 welcome')

  peer.send({
    v: 1,
    type: 'presence',
    payload: {
      device: { deviceId: 'dev-livepeer1', name: '自检伙伴', pet: 'main' },
      pets: [{ id: 'main', name: '自检伙伴的鱼', size: 400, display: 'web', assetRoot: 'main', x: 0.72, y: 0.9 }],
      work: null,
      at: Date.now(),
    },
  })

  log('▶ 等待真实实例看到对方宠物（/events 数据源）')
  const online = await waitUntil(
    () => service.snapshot().peers.find((p) => p.deviceId === 'dev-livepeer1' && p.pets.length > 0),
  )
  if (online) ok('看到 ' + online.name + '，宠物 ' + online.pets[0]?.name)
  else bad('没看到对方设备或宠物摘要')

  const events = await service.waitForChange(0, 100)
  if (events.ok && Array.isArray(events.peers)) ok('overlay 快照 peers=' + events.peers.length + ' version=' + events.version)
  else bad('overlay 快照异常')

  log('▶ 发一条「留言」给真实桌宠（只弹气泡，不动画）')
  const sent = await service.interact({ to: 'dev-livepeer1', intent: 'visit-note', note: '联机自检' })
  if (sent.ok) ok('互动帧 ' + sent.msgId)
  else bad('互动发送失败：' + JSON.stringify(sent))

  const got = await peer.wait((f) => f.type === 'interaction')
  if (got) ok('peer 收到 interaction intent=' + got.payload.intent)
  else bad('peer 没收到互动')

  peer.send({ v: 1, type: 'reaction', to: deviceId, payload: { msgId: sent.msgId, ok: true, reason: '', mode: 'full' } })
  const reaction = await waitUntil(() => service.snapshot().reactions.find((r) => r.msgId === sent.msgId))
  if (reaction) ok('收到回执 ok=' + reaction.ok)
  else bad('没收到回执')

  service.stop()
  peer.ws.close()
  log(failures === 0 ? '\n✅ 真机联调 OK（你的桌宠应已弹出一条留言气泡）' : `\n❌ ${failures} 处失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('真机自检异常：', error)
  process.exitCode = 1
})
