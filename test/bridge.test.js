import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createLocalBridge } from '../lib/local-bridge.js'

function fakePetServer() {
  const calls = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://pet.local')
    if (url.pathname === '/dsh-pet-7340/config') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          main: {
            pets: [{ id: 'main', name: '蓝毛小女仆', size: 462, display: 'web' }],
            animations: {
              clicks: ['点击回应-开心跃动'],
              categories: [{ id: '吃什么', actions: ['吃白饭'] }],
              idle: ['待机呼吸休闲'],
            },
          },
        }),
      )
      return
    }
    if (url.pathname === '/dsh-music/prefs') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          ok: true,
          prefs: {
            'dsh-music-playback': JSON.stringify({ name: '旧歌', artists: ['旧歌手'], ts: 1000 }),
            'dsh-music-qq-playback': JSON.stringify({ name: '晴天', artists: ['周杰伦'], ts: Date.now() }),
          },
        }),
      )
      return
    }
    calls.push({ method: req.method, path: url.pathname })
    req.on('data', () => {})
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls }))
  })
}

function ctxFor(origin) {
  return { webServer: { getOrigin: () => origin } }
}

test('bridge：bubbleOnly 只弹气泡，不动画不抛掷', async () => {
  const { server, calls } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))

  const full = await bridge.applyIntent('wave', { anim: 'click', text: '{from} 跟你打招呼啦' }, { from: '小鱼' })
  assert.equal(full.ok, true)
  assert.deepEqual(
    calls.map((c) => c.path).sort(),
    ['/dsh-pet-7340/anim', '/dsh-pet-7340/broadcast'],
  )

  calls.length = 0
  const quiet = await bridge.applyIntent('wave', { anim: 'click', text: '{from} 跟你打招呼啦' }, { from: '小鱼' }, { bubbleOnly: true })
  assert.equal(quiet.ok, true)
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/dsh-pet-7340/broadcast'],
  )

  await new Promise((r) => {
    server.closeAllConnections?.()
    server.close(r)
  })
})

test('bridge：读最近播放的音乐', async () => {
  const { server } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  const now = await bridge.musicNow()
  assert.equal(now.ok, true)
  assert.equal(now.track.name, '晴天')
  assert.deepEqual(now.track.artists, ['周杰伦'])
  assert.equal(now.track.source, 'qq')
  await new Promise((r) => {
    server.closeAllConnections?.()
    server.close(r)
  })
})

test('bridge：localPets 展开条目树并带 assetRoot', async () => {
  const { server } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  const { pets, pools } = await bridge.localPets()
  assert.equal(pets.length, 1)
  assert.equal(pets[0].id, 'main')
  assert.equal(pets[0].assetRoot, 'main')
  assert.equal(pets[0].idle, '待机呼吸休闲')
  assert.ok(pets[0].actions.includes('吃白饭'))
  assert.ok(pools.click.includes('点击回应-开心跃动'))
  assert.ok(pools.eat.includes('吃白饭'))
  await new Promise((r) => {
    server.closeAllConnections?.()
    server.close(r)
  })
})

test('bridge：睡觉/叫醒/动作意图落到 dsh-pet 对应端点', async () => {
  const { server, calls } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    const slept = await bridge.applyIntent('sleep', { anim: null, text: '{from} 哄你睡觉' }, { from: '小鱼' })
    assert.equal(slept.ok, true)
    assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/dsh-pet-7340/sleep'))

    calls.length = 0
    const woke = await bridge.applyIntent('wake', { anim: null, text: '{from} 叫醒你啦' }, { from: '小鱼' })
    assert.equal(woke.ok, true)
    assert.ok(calls.some((c) => c.path === '/dsh-pet-7340/wake'))

    calls.length = 0
    const played = await bridge.applyIntent('action', { anim: null, text: '{from} 让宠物表演了「{note}」' }, { from: '小鱼', note: '吃白饭' })
    assert.equal(played.ok, true)
    assert.ok(calls.some((c) => c.path === '/dsh-pet-7340/anim'))

    calls.length = 0
    const rejected = await bridge.applyIntent('action', { anim: null, text: 'x' }, { from: '小鱼', note: '不存在的动作' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.reason, 'unknown-animation')
    assert.equal(calls.some((c) => c.path === '/dsh-pet-7340/anim'), false)
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})

test('bridge：bubbleOnly 时睡觉也只弹气泡', async () => {
  const { server, calls } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    const result = await bridge.applyIntent('sleep', { anim: null, text: '{from} 哄你睡觉' }, { from: '小鱼' }, { bubbleOnly: true })
    assert.equal(result.ok, true)
    assert.deepEqual(calls.map((c) => c.path), ['/dsh-pet-7340/broadcast'])
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})
