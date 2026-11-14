import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createLocalBridge } from '../lib/local-bridge.js'

function fakePetServer(options = {}) {
  const calls = []
  const flags = { sleeping: options.sleeping === true }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://pet.local')
    const json = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/dsh-pet-7340/config') {
      json({
        ok: true,
        main: {
          pets: [{ id: 'main', name: '蓝毛小女仆', size: 462, display: 'web' }],
          animations: {
            clicks: ['点击回应-开心跃动'],
            categories: [{ id: '吃什么', name: '吃什么', actions: ['吃白饭', '大口吃零食'] }],
            idle: ['待机呼吸休闲'],
            turn: ['转身'],
          },
          memes: {
            Ciallo: '比耶打招呼',
            吃饱饱摸肚子: '吃饱了',
            深度睡眠: '睡着了',
          },
        },
      })
      return
    }
    if (url.pathname === '/dsh-pet-7340/state') {
      json({
        ok: true,
        counter: 1,
        pets: { main: { sleep: { counter: 1, data: { sleeping: options.reportSleeping ?? flags.sleeping } } } },
        sections: {},
      })
      return
    }
    if (url.pathname === '/dsh-pet-7340/sleep') {
      flags.sleeping = true
      calls.push({ method: req.method, path: url.pathname })
      json({ ok: true, sleeping: true })
      return
    }
    if (url.pathname === '/dsh-pet-7340/wake') {
      flags.sleeping = false
      calls.push({ method: req.method, path: url.pathname })
      json({ ok: true, sleeping: false })
      return
    }
    if (url.pathname === '/dsh-music/prefs') {
      json({
        ok: true,
        prefs: {
          'dsh-music-playback': JSON.stringify({ name: '旧歌', artists: ['旧歌手'], ts: 1000 }),
          'dsh-music-qq-playback': JSON.stringify({ name: '晴天', artists: ['周杰伦'], ts: Date.now() }),
        },
      })
      return
    }
    const record = { method: req.method, path: url.pathname }
    calls.push(record)
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        record.body = JSON.parse(raw || 'null')
      } catch {
        record.body = null
      }
      // 模拟 dsh-pet 的 sleepGated：睡觉时 anim/broadcast/chat 都拒绝
      if (flags.sleeping && ['/dsh-pet-7340/anim', '/dsh-pet-7340/broadcast', '/dsh-pet-7340/chat'].includes(url.pathname)) {
        json({ ok: false, reason: 'sleeping', message: '桌宠正在睡觉，先叫醒它' })
        return
      }
      if (url.pathname === '/dsh-pet-7340/chat') {
        json({ ok: true, text: '在呢' })
        return
      }
      json({ ok: true })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, calls, flags }))
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

test('bridge：投喂零食只播吃东西动画 + 气泡，不抛掷宠物', async () => {
  const { server, calls } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    const result = await bridge.applyIntent('treat', { anim: 'eat', text: '{from} 给你投喂了零食' }, { from: '小鱼' })
    assert.equal(result.ok, true)
    const paths = calls.map((c) => c.path)
    assert.ok(!paths.includes('/dsh-pet-7340/throw'), 'treat 不应调用 /throw（那是抛宠物）')
    assert.ok(paths.includes('/dsh-pet-7340/anim'))
    assert.ok(paths.includes('/dsh-pet-7340/broadcast'))
    const animCall = calls.find((c) => c.path === '/dsh-pet-7340/anim')
    assert.ok(/吃|零食/.test(animCall.body.name), '应挑吃东西类动画，实际：' + animCall.body.name)
    const say = calls.find((c) => c.path === '/dsh-pet-7340/broadcast')
    assert.equal(say.body.image, '吃饱饱摸肚子', '投喂气泡应带吃东西的表情包')
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
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

test('bridge：哄睡只调 /sleep，不广播（睡觉时广播必被拒）', async () => {
  const { server, calls } = await fakePetServer()
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    await bridge.getState()
    const result = await bridge.applyIntent('sleep', { anim: null, text: '{from} 哄你睡觉' }, { from: '小鱼' })
    assert.equal(result.ok, true)
    assert.deepEqual(calls.map((c) => c.path), ['/dsh-pet-7340/sleep'])
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})

test('bridge：已经睡着时再哄睡直接成功，不重复调用', async () => {
  const { server, calls, flags } = await fakePetServer({ sleeping: true })
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    await bridge.getState()
    const result = await bridge.applyIntent('sleep', { anim: null, text: '{from} 哄你睡觉' }, { from: '小鱼' })
    assert.equal(result.ok, true)
    assert.equal(flags.sleeping, true)
    assert.deepEqual(calls, [])
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})

test('bridge：睡觉中收到互动先叫醒，再播动画与气泡', async () => {
  const { server, calls, flags } = await fakePetServer({ sleeping: true })
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    await bridge.getState()
    const result = await bridge.applyIntent('wave', { anim: 'click', text: '{from} 跟你打招呼啦' }, { from: '小鱼' })
    assert.equal(result.ok, true)
    assert.deepEqual(
      calls.map((c) => c.path),
      ['/dsh-pet-7340/wake', '/dsh-pet-7340/anim', '/dsh-pet-7340/broadcast'],
    )
    assert.equal(flags.sleeping, false)
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})

test('bridge：本地 sleep 缓存过期时靠 sleeping 报错触发补叫醒', async () => {
  const { server, calls, flags } = await fakePetServer({ sleeping: true, reportSleeping: false })
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    await bridge.getState() // 缓存的仍是「醒着」
    const result = await bridge.applyIntent('wave', { anim: 'click', text: '{from} 跟你打招呼啦' }, { from: '小鱼' })
    assert.equal(result.ok, true)
    assert.deepEqual(
      calls.map((c) => c.path),
      [
        '/dsh-pet-7340/anim',
        '/dsh-pet-7340/broadcast',
        '/dsh-pet-7340/wake',
        '/dsh-pet-7340/anim',
        '/dsh-pet-7340/broadcast',
      ],
    )
    assert.equal(flags.sleeping, false)
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})

test('bridge：宠物睡着时聊天会先叫醒再说话', async () => {
  const { server, calls, flags } = await fakePetServer({ sleeping: true })
  const bridge = createLocalBridge(ctxFor(`http://127.0.0.1:${server.address().port}`))
  try {
    await bridge.getState()
    const result = await bridge.chat('main', '你在吗')
    assert.equal(result.ok, true)
    assert.equal(result.text, '在呢')
    assert.deepEqual(
      calls.map((c) => c.path),
      ['/dsh-pet-7340/wake', '/dsh-pet-7340/chat'],
    )
    assert.equal(flags.sleeping, false)
  } finally {
    await new Promise((r) => {
      server.closeAllConnections?.()
      server.close(r)
    })
  }
})
