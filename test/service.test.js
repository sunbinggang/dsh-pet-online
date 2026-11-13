import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { apply } from '../lib/index.js'

function fakePetServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://pet.local')
    const send = (value) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname === '/dsh-pet-7340/state') return send({ ok: true, counter: 1, sections: {}, pets: {} })
    if (url.pathname === '/dsh-pet-7340/config') {
      return send({
        ok: true,
        main: {
          pets: [{ id: 'main', name: '蓝毛小女仆', size: 462, display: 'web' }],
          animations: {
            clicks: ['点击回应-开心跃动'],
            categories: [{ id: '吃什么', actions: ['吃白饭'] }],
            idle: ['待机呼吸休闲'],
          },
        },
      })
    }
    send({ ok: true })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function fakeCtx(origin) {
  const routes = []
  const disposers = []
  return {
    routes,
    webServer: {
      getOrigin: () => origin,
      port: Number(new URL(origin).port),
      register(route) {
        routes.push(route)
        return () => {}
      },
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

function fakeReq(method, url, body) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.socket = { remoteAddress: '127.0.0.1' }
  req.headers = { host: '127.0.0.1:62142' }
  if (body !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  } else {
    setImmediate(() => req.emit('end'))
  }
  return req
}

function fakeRes() {
  const res = {
    status: 0,
    body: '',
    writeHead(status) {
      res.status = status
    },
    end(chunk) {
      if (chunk !== undefined) res.body += String(chunk)
    },
  }
  return res
}

test('宿主半侧：apply 注册路由，ping/state/config/pairing 可用', async () => {
  const pet = await fakePetServer()
  const origin = `http://127.0.0.1:${pet.address().port}`
  const home = await mkdtemp(join(tmpdir(), 'dsh-pet-online-'))
  process.env.DSH_HOME = home
  // 关掉 relay，避免测试里反复重连
  await mkdir(join(home, 'dsh-pet-online'), { recursive: true })
  await writeFile(join(home, 'dsh-pet-online', 'config.json'), JSON.stringify({ enabled: false }), 'utf8')

  const ctx = fakeCtx(origin)
  apply(ctx)
  assert.equal(ctx.routes.length, 1)
  const handler = ctx.routes[0].handler
  assert.equal(ctx.routes[0].path, '/dsh-pet-online')

  const call = async (method, path, body) => {
    const res = fakeRes()
    await handler(fakeReq(method, path, body), res)
    const json = res.body === '' ? null : JSON.parse(res.body)
    return { status: res.status, json }
  }

  const ping = await call('GET', '/dsh-pet-online/ping')
  assert.equal(ping.status, 200)
  assert.equal(ping.json.ok, true)

  const state = await call('GET', '/dsh-pet-online/state')
  assert.equal(state.status, 200)
  assert.equal(state.json.ok, true)
  assert.equal(typeof state.json.device.id, 'string')
  assert.ok(Array.isArray(state.json.peers))

  const events = await call('GET', '/dsh-pet-online/events?since=0&timeout=50')
  assert.equal(events.status, 200)
  assert.equal(events.json.ok, true)
  assert.equal(typeof events.json.version, 'number')
  assert.deepEqual(events.json.peers, [])

  const pairing = await call('POST', '/dsh-pet-online/pairing/new', {})
  assert.equal(pairing.status, 200)
  assert.equal(pairing.json.code.length, 6)

  const badCode = await call('POST', '/dsh-pet-online/pairing', { code: '!!' })
  assert.equal(badCode.status, 400)
  assert.equal(badCode.json.reason, 'invalid-code')

  const interact = await call('POST', '/dsh-pet-online/interact', { to: 'dev-nobody', intent: 'wave' })
  assert.equal(interact.status, 400)
  assert.equal(interact.json.reason, 'unknown-peer')

  ctx.disposeAll()
  await new Promise((r) => {
    pet.closeAllConnections?.()
    pet.close(r)
  })
})
