import test from 'node:test'
import assert from 'node:assert/strict'
import { createRelayServer } from '../relay/server.mjs'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

/** 连接并带缓冲的测试客户端：消息可能在 wait 挂上之前就到了。 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const frames = []
    const waiters = []
    ws.onmessage = (event) => {
      let frame
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        return
      }
      frames.push(frame)
      for (const waiter of [...waiters]) {
        if (waiter.predicate(frame)) {
          waiters.splice(waiters.indexOf(waiter), 1)
          clearTimeout(waiter.timer)
          waiter.resolve(frame)
        }
      }
    }
    ws.onerror = (event) => reject(new Error('ws error: ' + (event?.message ?? 'unknown')))
    ws.onopen = () =>
      resolve({
        ws,
        frames,
        send(value) {
          ws.send(JSON.stringify(value))
        },
        wait(predicate, timeoutMs = 3000) {
          const hit = frames.find(predicate)
          if (hit) return Promise.resolve(hit)
          return new Promise((res, rej) => {
            const waiter = { predicate, resolve: res }
            waiter.timer = setTimeout(() => {
              const index = waiters.indexOf(waiter)
              if (index >= 0) waiters.splice(index, 1)
              rej(new Error('timeout waiting for frame; got: ' + JSON.stringify(frames.map((f) => f.type))))
            }, timeoutMs)
            waiters.push(waiter)
          })
        },
      })
  })
}

function hello(client, deviceId, name) {
  client.send({ v: 1, type: 'hello', payload: { deviceId, name, pet: 'main' } })
}

async function cleanup(server, ...clients) {
  for (const client of clients) {
    try {
      client.ws.close()
    } catch {
      /* ignore */
    }
  }
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
}

test('relay：两台设备配对后能互发互动帧，房间互相隔离', async () => {
  const server = createRelayServer()
  const port = await listen(server)
  const room = 'pair:TEST23'
  const a = await connect(`ws://127.0.0.1:${port}/?room=${room}`)
  hello(a, 'dev-aaa111', 'A')
  await a.wait((f) => f.type === 'welcome')

  const b = await connect(`ws://127.0.0.1:${port}/?room=${room}`)
  hello(b, 'dev-bbb222', 'B')
  const welcomeB = await b.wait((f) => f.type === 'welcome')
  assert.equal(welcomeB.payload.peers.length, 1)
  assert.equal(welcomeB.payload.peers[0].deviceId, 'dev-aaa111')

  // A 从 presence 里知道 B 上线
  const presence = await a.wait((f) => f.type === 'presence' && f.payload?.device?.deviceId === 'dev-bbb222')
  assert.equal(presence.payload.device.name, 'B')

  // A 发互动给 B
  a.send({ v: 1, type: 'interaction', to: 'dev-bbb222', payload: { msgId: 'm-1', intent: 'wave' } })
  const got = await b.wait((f) => f.type === 'interaction')
  assert.equal(got.from, 'dev-aaa111')
  assert.equal(got.payload.intent, 'wave')

  // 房间隔离：另一个房间收不到
  const c = await connect(`ws://127.0.0.1:${port}/?room=pair:OTHER2`)
  hello(c, 'dev-ccc333', 'C')
  await c.wait((f) => f.type === 'welcome')
  a.send({ v: 1, type: 'interaction', to: 'dev-bbb222', payload: { msgId: 'm-2', intent: 'poke' } })
  await b.wait((f) => f.type === 'interaction' && f.payload.msgId === 'm-2')
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(c.frames.some((f) => f.type === 'interaction'), false)

  await cleanup(server, a, b, c)
})

test('relay：未知目标返回 peer-offline，房间满拒绝', async () => {
  const server = createRelayServer()
  const port = await listen(server)
  const room = 'pair:FULL22'
  const conns = []
  for (let i = 0; i < 9; i += 1) {
    const client = await connect(`ws://127.0.0.1:${port}/?room=${room}`)
    hello(client, `dev-${String(i).padStart(6, '0')}`, 'P' + i)
    conns.push(client)
  }
  // 第 9 台：房间满（上限 8）
  const ninth = await conns[8].wait((f) => f.type === 'error' || f.type === 'welcome')
  assert.equal(ninth.type, 'error')
  assert.equal(ninth.payload.message, 'room-full')

  conns[0].send({ v: 1, type: 'interaction', to: 'dev-999999', payload: { msgId: 'x', intent: 'wave' } })
  const err = await conns[0].wait((f) => f.type === 'error' && f.payload.message === 'peer-offline')
  assert.ok(err)

  await cleanup(server, ...conns)
})
