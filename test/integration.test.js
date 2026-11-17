import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir, networkInterfaces } from 'node:os'
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
    if (url.pathname === '/dsh-music/prefs') {
      const prefs = {}
      if (options.music) {
        prefs['dsh-music-nc-playback'] = JSON.stringify({
          id: options.music.id ?? 'nc:1',
          name: options.music.name,
          artists: options.music.artists ?? [],
          ts: Date.now(),
        })
      }
      return send({ ok: true, prefs })
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

test('端到端：纯文字消息不走对端 LLM', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-r1-')), petA.origin, 'R1', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-r2-')), petB.origin, 'R2', relayUrl)
  try {
    await a.pair('RAW234')
    await b.pair('RAW234')
    await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
    await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))

    const sent = await a.chat({ to: b.deviceId, text: '这是一条原文', raw: true })
    assert.equal(sent.ok, true)

    const received = await waitUntil(() =>
      (b.snapshot().chats[a.deviceId] ?? []).find((m) => m.raw === true && m.text === '这是一条原文'),
    )
    assert.ok(received)
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(petB.calls.some((c) => c.path === '/dsh-pet-7340/chat'), false, 'raw 消息不应调用对端 LLM')
    assert.ok(petB.calls.some((c) => c.path === '/dsh-pet-7340/broadcast'), 'raw 消息应让对端宠物冒泡')
    assert.equal((a.snapshot().chats[b.deviceId] ?? []).some((m) => m.from === 'me' && m.raw === true), true)
  } finally {
    a.stop()
    b.stop()
    petA.server.closeAllConnections?.()
    petB.server.closeAllConnections?.()
    await new Promise((r) => petA.server.close(r))
    await new Promise((r) => petB.server.close(r))
    relay.closeAllConnections?.()
    await new Promise((r) => relay.close(r))
  }
})

test('端到端：音乐分享默认不自动播，勾选后自动播；睡觉/动作直达对方宠物', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-m1-')), petA.origin, 'M1', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-m2-')), petB.origin, 'M2', relayUrl)
  try {
    await a.pair('MUS234')
    await b.pair('MUS234')
    await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
    await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))

    const track = { id: 'nc:123', name: '冻结', artists: ['林俊杰'], source: 'nc' }
    const shared = await a.interact({ to: b.deviceId, intent: 'music', note: '冻结 - 林俊杰', track })
    assert.equal(shared.ok, true)
    const first = await waitUntil(() => b.snapshot().musicShares[0])
    assert.equal(first.track.name, '冻结')
    assert.equal(first.track.id, 'nc:123')
    assert.equal(b.snapshot().playRequest.track, null, '默认不自动播放')

    const manual = b.requestMusicPlay(first.seq)
    assert.equal(manual.ok, true)
    assert.equal(b.snapshot().playRequest.track.name, '冻结')

    await b.setConfig({ acceptRemoteMusic: true })
    await a.interact({ to: b.deviceId, intent: 'music', note: '晴天 - 周杰伦', track: { id: 'qq:abc', name: '晴天', artists: ['周杰伦'], source: 'qq' } })
    const auto = await waitUntil(() => b.snapshot().playRequest.track && b.snapshot().playRequest.track.name === '晴天')
    assert.ok(auto)

    assert.equal((await a.interact({ to: b.deviceId, intent: 'sleep' })).ok, true)
    await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/sleep'))
    assert.equal((await a.interact({ to: b.deviceId, intent: 'wake' })).ok, true)
    await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/wake'))
    assert.equal((await a.interact({ to: b.deviceId, intent: 'action', note: '吃白饭' })).ok, true)
    await waitUntil(() => petB.calls.find((c) => c.path === '/dsh-pet-7340/anim'))
  } finally {
    a.stop()
    b.stop()
    petA.server.closeAllConnections?.()
    petB.server.closeAllConnections?.()
    await new Promise((r) => petA.server.close(r))
    await new Promise((r) => petB.server.close(r))
    relay.closeAllConnections?.()
    await new Promise((r) => relay.close(r))
  }
})

test('端到端：一侧切歌，另一侧收到 music-sync 并交给本机音乐插件', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼', { music: { name: '晴天', artists: ['周杰伦'], id: 'nc:7788' } })
  const petB = await fakePetServer('B 的鱼')
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-sy1-')), petA.origin, 'S1', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-sy2-')), petB.origin, 'S2', relayUrl)
  try {
    await a.pair('SYN234')
    await b.pair('SYN234')
    await waitUntil(() => a.snapshot().relay.status === 'online' && b.snapshot().relay.status === 'online')
    await waitUntil(() => a.snapshot().peers.find((p) => p.deviceId === b.deviceId))

    // B 关掉跟播时，A 的切歌不会进入 B 的同步队列。
    await b.setConfig({ syncMusic: false })
    const pushed = await a.syncMusicNow()
    assert.equal(pushed.ok, true)
    assert.equal(pushed.track.name, '晴天')
    assert.equal(pushed.sent, 1)
    assert.equal(b.snapshot().musicSync, null, '关掉跟播时不接收')

    await b.setConfig({ syncMusic: true })
    const again = await a.syncMusicNow()
    assert.equal(again.ok, true)
    const sync = await waitUntil(() => b.snapshot().musicSync)
    const synced = sync.track
    assert.equal(synced.name, '晴天')
    assert.equal(synced.id, 'nc:7788')
    assert.equal(synced.source, 'nc')
    assert.equal(sync.fromName, 'S1')

    // 页面手里有最新曲目时直接给 track：不再依赖宿主 prefs 的防抖快照。
    const direct = await a.syncMusicNow({ id: 'nc:9999', name: '夜曲', artists: ['周杰伦'], source: 'nc' })
    assert.equal(direct.ok, true)
    await waitUntil(
      () => b.snapshot().musicSync && b.snapshot().musicSync.track.id === 'nc:9999',
    )

    // 同一首的进度心跳：位置更新只推 posSeq，不换 seq（接收端只校准，不重新起播）。
    const before = b.snapshot().musicSync
    await a.syncMusicNow({ id: 'nc:9999', name: '夜曲', artists: ['周杰伦'], source: 'nc', position: 66.6 })
    const after = await waitUntil(
      () => {
        const s = b.snapshot().musicSync
        return s && s.track.id === 'nc:9999' && s.track.position === 66.6 ? s : null
      },
      3000,
    )
    assert.equal(after.seq, before.seq)
    assert.ok(after.posSeq > before.posSeq)

    // 关掉跟播时，页面自动上报的切歌不广播。
    await a.setConfig({ syncMusic: false })
    const muted = await a.syncMusicNow({ id: 'nc:10000', name: '稻香', source: 'nc' }, { auto: true })
    assert.equal(muted.ok, false)
    assert.equal(muted.reason, 'disabled')
    await a.setConfig({ syncMusic: true })
  } finally {
    a.stop()
    b.stop()
    petA.server.closeAllConnections?.()
    petB.server.closeAllConnections?.()
    await new Promise((r) => petA.server.close(r))
    await new Promise((r) => petB.server.close(r))
    relay.closeAllConnections?.()
    await new Promise((r) => relay.close(r))
  }
})

test('端到端：中继地址填本机局域网 IP 也会自动起中继', async (t) => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((item) => item && item.family === 'IPv4' && item.internal === false)
  if (!lan) {
    t.skip('本机没有局域网 IPv4 地址')
    return
  }
  const port = await freePort()
  const pet = await fakePetServer('A 的鱼')
  const service = await makeService(await mkdtemp(join(tmpdir(), 'dpo-lan-')), pet.origin, 'LAN', `ws://${lan.address}:${port}/ws`)
  try {
    await service.pair('LAN234')
    const online = await waitUntil(() => service.snapshot().relay.status === 'online', 10_000)
    assert.ok(online, 'relay URL 用本机局域网 IP 时也应该自动起本机中继')
  } finally {
    service.stop()
    pet.server.closeAllConnections?.()
    await new Promise((r) => pet.server.close(r))
  }
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

test('端到端：三人同房间互相可见，群发互动和群发文字命中所有人', async () => {
  const relay = createRelayServer()
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve))
  const relayUrl = `ws://127.0.0.1:${relay.address().port}/ws`

  const petA = await fakePetServer('A 的鱼')
  const petB = await fakePetServer('B 的鱼')
  const petC = await fakePetServer('C 的鱼')
  const a = await makeService(await mkdtemp(join(tmpdir(), 'dpo-m1-')), petA.origin, 'M1', relayUrl)
  const b = await makeService(await mkdtemp(join(tmpdir(), 'dpo-m2-')), petB.origin, 'M2', relayUrl)
  const c = await makeService(await mkdtemp(join(tmpdir(), 'dpo-m3-')), petC.origin, 'M3', relayUrl)

  try {
    for (const service of [a, b, c]) await service.pair('MULT23')
    await waitUntil(() => [a, b, c].every((service) => service.snapshot().relay.status === 'online'))
    await waitUntil(() =>
      [a, b, c].every(
        (service) =>
          service.snapshot().peers.length === 2 && service.snapshot().peers.every((p) => p.pets.length === 1),
      ),
    )
    await waitUntil(() => {
      const names = a.snapshot().peers.map((p) => p.pets[0]?.name).sort()
      return names.includes('B 的鱼') && names.includes('C 的鱼')
    })
    assert.deepEqual(a.snapshot().room, { members: 3, capacity: 8 })

    const wave = await a.interactAll({ intent: 'wave' })
    assert.equal(wave.ok, true)
    assert.equal(wave.sent, 2)
    await waitUntil(() => petB.calls.find((call) => call.path === '/dsh-pet-7340/anim'))
    await waitUntil(() => petC.calls.find((call) => call.path === '/dsh-pet-7340/anim'))

    const chat = await a.chatAll({ text: '大家好呀', raw: true })
    assert.equal(chat.ok, true)
    assert.equal(chat.sent, 2)
    await waitUntil(() => (b.snapshot().chats[a.deviceId] ?? []).find((m) => m.text === '大家好呀'))
    await waitUntil(() => (c.snapshot().chats[a.deviceId] ?? []).find((m) => m.text === '大家好呀'))
    await waitUntil(() => petB.calls.find((call) => call.path === '/dsh-pet-7340/broadcast'))
    await waitUntil(() => petC.calls.find((call) => call.path === '/dsh-pet-7340/broadcast'))
  } finally {
    a.stop()
    b.stop()
    c.stop()
    for (const pet of [petA, petB, petC]) {
      pet.server.closeAllConnections?.()
      await new Promise((r) => pet.server.close(r))
    }
    relay.closeAllConnections?.()
    await new Promise((r) => relay.close(r))
  }
})
