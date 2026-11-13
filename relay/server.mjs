#!/usr/bin/env node
/**
 * dsh-pet-online relay —— 零依赖房间转发服务。
 *
 * 职责只有三件事：收下 WebSocket 连接、按房间聚合、把帧转发给目标设备。
 * 不落盘、不解析业务内容、不做账号：配对码就是房间名，房间空了自动消失。
 *
 * 用法：
 *   node relay/server.mjs [port]          # 默认 7420
 *   PORT=7421 node relay/server.mjs
 *
 * 协议（JSON 文本帧，帧体 ≤ 64 KiB）：
 *   hello        C→R  { deviceId, name, pet }        加入房间
 *   welcome      R→C  { peers: [{deviceId,name,pet}], room }
 *   presence     C→R  { device:{id,name,pet}, pets:[], work }   R 转发给房间其它人
 *   interaction  C→R  { to, payload:{msgId,intent,note,fromName} }   R 转发给 to
 *   reaction     C→R  { to, payload:{msgId,ok,reason} }              R 转发给 to
 *   ping/pong    心跳（应用层，20s 一次）
 *   error        R→C  { message }
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const MAX_FRAME = 64 * 1024
const MAX_MEMBERS = 8
const MSG_PER_SEC = 40
const IDLE_TIMEOUT_MS = 90_000

const rooms = new Map()
let connectionSeq = 0

function text(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').trim().slice(0, max)
}

function wsFrame(opcode, payload) {
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len])
  } else if (len < 65_536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeUInt32BE(0, 2)
    header.writeUInt32BE(len, 6)
  }
  return Buffer.concat([header, payload])
}

function attach(socket) {
  const conn = {
    id: ++connectionSeq,
    socket,
    room: '',
    deviceId: '',
    profile: null,
    closed: false,
    buffer: Buffer.alloc(0),
    fragments: [],
    windowAt: 0,
    windowCount: 0,
    lastAt: Date.now(),
  }

  function send(value) {
    if (conn.closed) return
    try {
      socket.write(wsFrame(1, Buffer.from(JSON.stringify(value), 'utf8')))
    } catch {
      close()
    }
  }

  function close() {
    if (conn.closed) return
    conn.closed = true
    try {
      socket.write(wsFrame(8, Buffer.alloc(0)))
    } catch {
      /* ignore */
    }
    socket.destroy()
  }

  conn.send = send

  function leave() {
    if (conn.room === '' || conn.deviceId === '') return
    const members = rooms.get(conn.room)
    if (!members) return
    if (members.get(conn.deviceId) === conn) members.delete(conn.deviceId)
    if (members.size === 0) rooms.delete(conn.room)
    else broadcast(conn.room, { type: 'peer-leave', payload: { deviceId: conn.deviceId } }, conn)
  }

  function onText(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return

    // 应用层限流：单连接每秒最多 MSG_PER_SEC 条。
    const now = Date.now()
    if (now - conn.windowAt >= 1000) {
      conn.windowAt = now
      conn.windowCount = 0
    }
    conn.windowCount += 1
    if (conn.windowCount > MSG_PER_SEC) {
      send({ type: 'error', payload: { message: 'rate-limited' } })
      return
    }
    conn.lastAt = now

    if (msg.type === 'hello') {
      const id = String(msg.payload?.deviceId ?? '')
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) {
        send({ type: 'error', payload: { message: 'bad-device-id' } })
        return
      }
      const room = conn.room
      let members = rooms.get(room)
      if (!members) {
        members = new Map()
        rooms.set(room, members)
      }
      if (members.size >= MAX_MEMBERS && !members.has(id)) {
        send({ type: 'error', payload: { message: 'room-full' } })
        close()
        return
      }
      const old = members.get(id)
      if (old && old !== conn) old.close()
      conn.deviceId = id
      conn.profile = {
        deviceId: id,
        name: text(msg.payload?.name, 24),
        pet: text(msg.payload?.pet, 48),
      }
      members.set(id, conn)
      const peers = [...members.values()]
        .filter((c) => c !== conn && c.profile !== null && !c.closed)
        .map((c) => c.profile)
      send({ type: 'welcome', payload: { peers, room } })
      broadcast(conn.room, { type: 'presence', payload: { device: conn.profile, pets: [], work: null, at: Date.now() } }, conn)
      return
    }

    if (msg.type === 'ping') {
      send({ type: 'pong', payload: { at: Date.now() } })
      return
    }

    if (conn.deviceId === '') return

    const members = rooms.get(conn.room)
    if (!members) return

    if (msg.type === 'presence') {
      const device = msg.payload?.device
      if (device && typeof device.name === 'string') {
        conn.profile = { ...conn.profile, name: text(device.name, 24), pet: text(device.pet, 48) }
      }
      broadcast(conn.room, { ...msg, from: conn.deviceId }, conn)
      return
    }

    if (msg.type === 'interaction' || msg.type === 'reaction' || msg.type === 'chat' || msg.type === 'chat-reply') {
      const to = String(msg.to ?? '')
      const target = members.get(to)
      if (!target) {
        send({ type: 'error', payload: { message: 'peer-offline' } })
        return
      }
      target.send({ ...msg, from: conn.deviceId, at: Date.now() })
      return
    }
  }

  socket.on('data', (chunk) => {
    conn.lastAt = Date.now()
    conn.buffer = Buffer.concat([conn.buffer, chunk])
    if (conn.buffer.length > MAX_FRAME) {
      close()
      return
    }
    drain()
  })

  function drain() {
    while (!conn.closed) {
      const buf = conn.buffer
      if (buf.length < 2) return
      const b0 = buf[0]
      const b1 = buf[1]
      const fin = (b0 & 0x80) !== 0
      const opcode = b0 & 0x0f
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let offset = 2
      if (len === 126) {
        if (buf.length < 4) return
        len = buf.readUInt16BE(2)
        offset = 4
      } else if (len === 127) {
        if (buf.length < 10) return
        const hi = buf.readUInt32BE(2)
        const lo = buf.readUInt32BE(6)
        len = hi * 2 ** 32 + lo
        offset = 10
      }
      if (len > MAX_FRAME) {
        close()
        return
      }
      if (!masked) {
        close()
        return
      }
      if (buf.length < offset + 4 + len) return
      const mask = buf.subarray(offset, offset + 4)
      const payload = Buffer.allocUnsafe(len)
      for (let i = 0; i < len; i += 1) payload[i] = buf[offset + 4 + i] ^ mask[i & 3]
      conn.buffer = buf.subarray(offset + 4 + len)

      if (opcode === 8) {
        close()
        return
      }
      if (opcode === 9) {
        try {
          socket.write(wsFrame(10, payload))
        } catch {
          close()
        }
        continue
      }
      if (opcode === 10) continue
      if (opcode === 1 || opcode === 0) {
        if (!fin) {
          conn.fragments.push(payload)
          if (conn.fragments.reduce((n, p) => n + p.length, 0) > MAX_FRAME) close()
          continue
        }
        const full = conn.fragments.length > 0 ? Buffer.concat([...conn.fragments, payload]) : payload
        conn.fragments = []
        if (full.length > MAX_FRAME) {
          close()
          return
        }
        onText(full.toString('utf8'))
        continue
      }
      // 二进制帧：本协议不用，丢弃。
    }
  }

  socket.on('close', () => {
    conn.closed = true
    leave()
  })
  socket.on('error', () => {
    conn.closed = true
    leave()
  })

  const idle = setInterval(() => {
    if (Date.now() - conn.lastAt > IDLE_TIMEOUT_MS) {
      close()
      clearInterval(idle)
    }
  }, 15_000)
  idle.unref?.()

  return { conn, leave }
}

function broadcast(room, message, except) {
  const members = rooms.get(room)
  if (!members) return
  for (const conn of members.values()) {
    if (conn === except || conn.closed) continue
    conn.send(message)
  }
}

/** 创建一个 relay HTTP/WS 服务（不自动 listen，测试可直接用）。 */
export function createRelayServer() {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      let members = 0
      for (const room of rooms.values()) members += room.size
      const body = JSON.stringify({ ok: true, rooms: rooms.size, members, uptime: process.uptime() })
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(body)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dsh-pet-online relay: upgrade required')
  })

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || key === '' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy()
      return
    }
    let room = ''
    try {
      const url = new URL(req.url ?? '/', 'http://relay.local')
      room = String(url.searchParams.get('room') ?? '').slice(0, 64)
    } catch {
      socket.destroy()
      return
    }
    if (room === '') {
      socket.destroy()
      return
    }
    const acceptValue = createHash('sha1').update(key + GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptValue}\r\n\r\n`,
    )
    const { conn } = attach(socket)
    conn.room = room
  })

  return server
}

/** 进程入口：`node relay/server.mjs [port]` 才监听。 */
function startFromCli() {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 7420)
  const server = createRelayServer()
  server.listen(port, '0.0.0.0', () => {
    console.log(`[dsh-pet-online relay] listening on ws://0.0.0.0:${port}/?room=<room>`)
  })
  return server
}

const isMain = process.argv[1] !== undefined && /server\.mjs$/.test(process.argv[1])
if (isMain) startFromCli()

export { rooms }
