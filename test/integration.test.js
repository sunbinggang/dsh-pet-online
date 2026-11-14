import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOnlineService } from '../lib/service.js'
import { createRelayServer } from '../relay/server.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function waitUntil(fn, timeoutMs = 8000, step = 100) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const value = await fn()
    if (value) return value
    await sleep(step)
  }
  throw new Error('waitUntil timeout')
}

function fakePetServer(name, options = {}) {
  const calls = []
  const sections = options.focus
    ? { focusSession: { counter: 1, data: { sessionId: 's1', ts: Date.now() } } }
    : {}
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://pet.local')
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/dsh-pet-7340/state') {
      const since = url.searchParams.get('since')
      if (since !== null) {
        // 模拟长轮询：已是最新就挂一会儿
        setTimeout(() => send({ ok: true, counter: 1, sections, pets: {} }), 200)
        return
      }
      return send({ ok: true, counter: 1, sections, pets: {} })
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
    calls.push({ method: req.method, path: url.pathname, query: url.search, body: '' })
    req.on('data', () => {})
    req.on('end', () => {
      if (url.pathname === '/dsh-pet-7340/chat') {
        send({ ok: true, text: '你好呀，我是 ' + name })
        return
      }
      send({ ok: true })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, calls, origin: `http://127.0.0.1:${server.address().port}` }),
    )
  })
}

function fakeCtx(origin) {
  const disposers = []
  return {
    webServer: {
      getOrigin: () => origin,
      register: () => () => {},
    },
    effect(fn) {
      const dispose = fn()
      disposers.push(() => dispose?.())
      return () => dispose?.()
    },
    disposeAll() {
      for (const dispose of disposers.splice(0)) dispose()
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

test('端到端：A 的互动帧经 relay 到达 B，B 真的驱动本机 dsh-pet', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayPort = relay.address().port
  const relayUrl = `ws://127.0.0.1:${relayPort}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const homeA = await mkdtemp(join(tmpdir(), 'dpo-a-'))
  const homeB = await mkdtemp(join(tmpdir(), 'dpo-b-'))

  const a = await makeService(homeA, petA.origin, 'A', relayUrl)
  const b = await makeService(homeB, petB.origin, 'B', relayUrl)

  await a.pair('TEST23')
  await b.pair('TEST23')

  await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
  const peerB = await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))
  assert.ok(peerB)

  const result = await a.interact({ to: b.deviceId, intent: 'wave' })
  assert.equal(result.ok, true, 'interact failed: ' + JSON.stringify(result))

  const broadcast = await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/broadcast'))
  assert.ok(broadcast.query.includes('pet=main'))
  const anim = await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/anim'))
  assert.ok(anim)

  a.stop()
  b.stop()
  petA.server.closeAllConnections?.()
  petB.server.closeAllConnections?.()
  await new Promise((r) => petA.server.close(r))
  await new Promise((r) => petB.server.close(r))
  relay.closeAllConnections?.()
  await new Promise((r) => relay.close(r))
})

test('端到端：跨机聊天走对方 LLM 人设并回到本机记录', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-e-')), petA.origin, 'E', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-f-')), petB.origin, 'F', relayUrl)

  await a.pair('CHT234')
  await b.pair('CHT234')
  await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
  await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))

  const sent = await a.chat({ to: b.deviceId, text: '你好，你叫什么？' })
  assert.equal(sent.ok, true)
  const chatCall = await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/chat'))
  assert.ok(chatCall)

  const reply = await waitUntil(() => {
    const list = a.snapshot().chats[b.deviceId] ?? []
    return list.find((m) => m.from === 'them')
  })
  assert.match(reply.text, /我是 B 的鱼/)

  const mine = a.snapshot().chats[b.deviceId].find((m) => m.from === 'me')
  assert.equal(mine.text, '你好，你叫什么？')

  a.stop()
  b.stop()
  petA.server.closeAllConnections?.()
  petB.server.closeAllConnections?.()
  await new Promise((r) => petA.server.close(r))
  await new Promise((r) => petB.server.close(r))
  relay.closeAllConnections?.()
  await new Promise((r) => relay.close(r))
})

test('端到端：relay 地址指向本机时自动启动中继', async () => {
  const port = await freePort()
  const petA = await fakePetServer('A 的鱼')
  const home = await mkdtemp(join(tmpdir(), 'dpo-g-'))
  const service = await makeService(home, petA.origin, 'G', `ws://127.0.0.1:${port}/ws`)
  try {
    const paired = await service.pair('AUT234')
    assert.equal(paired.ok, true)
    const online = await waitUntil(() => service.snapshot().relay.status === 'online')
    assert.ok(online, 'auto relay should make the client online')
  } finally {
    service.stop()
    petA.server.closeAllConnections?.()
    await new Promise((r) => petA.server.close(r))
  }
})

test('端到端：对方专注会话中时互动降级为仅气泡', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼', { focus: true })
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-c-')), petA.origin, 'C', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-d-')), petB.origin, 'D', relayUrl)

  await a.pair('FCS234')
  await b.pair('FCS234')
  await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
  await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))
  // 等 B 的状态轮询读到 focusSession
  await new Promise((r) => setTimeout(r, 500))

  const result = await a.interact({ to: b.deviceId, intent: 'wave' })
  assert.equal(result.ok, true)
  const broadcast = await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/broadcast'))
  assert.ok(broadcast)
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(petB.calls.some((c) => c.path === '/dsh-pet-7340/anim'), false)

  const reaction = await waitUntil(() => a.snapshot().reactions.find((r) => r.msgId === result.msgId))
  assert.equal(reaction.mode, 'bubble')

  a.stop()
  b.stop()
  petA.server.closeAllConnections?.()
  petB.server.closeAllConnections?.()
  await new Promise((r) => petA.server.close(r))
  await new Promise((r) => petB.server.close(r))
  relay.closeAllConnections?.()
  await new Promise((r) => relay.close(r))
})
