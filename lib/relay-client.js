/**
 * relay 客户端（host 半侧）。
 *
 * 走 Node 22 自带的全局 WebSocket（undici），不引第三方依赖。
 * 职责：连接/断线重连、心跳、把入站帧交给 service、把出站帧发出去。
 * 配对码 = 房间名，relay 只做扇出，不存任何业务状态。
 */

import { PROTOCOL_VERSION, isEnvelope, isValidDeviceId, roomOf } from './protocol.js'

const HEARTBEAT_MS = 20_000
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

export function createRelayClient(options) {
  const {
    url,
    code,
    deviceId,
    profile = {},
    onWelcome,
    onPresence,
    onInteraction,
    onReaction,
    onChat,
    onChatReply,
    onPeerLeave,
    onStatus,
  } = options

  let socket = null
  let stopped = false
  let heartbeat = null
  let reconnectTimer = null
  let attempt = 0
  let status = 'idle'
  let lastError = ''

  const room = roomOf(code)

  function setStatus(next, error = '') {
    status = next
    lastError = error
    onStatus?.({ status, error, room })
  }

  function scheduleReconnect() {
    if (stopped) return
    attempt += 1
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempt, 5))
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => connect(), delay)
    reconnectTimer.unref?.()
  }

  function connect() {
    if (stopped || !url || !isValidDeviceId(deviceId)) return
    clearTimeout(reconnectTimer)
    try {
      socket = new WebSocket(url + (url.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(room))
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
      scheduleReconnect()
      return
    }
    setStatus('connecting')
    socket.binaryType = 'arraybuffer'

    socket.onopen = () => {
      attempt = 0
      setStatus('online')
      send({
        v: PROTOCOL_VERSION,
        type: 'hello',
        payload: {
          deviceId,
          name: profile.name ?? '',
          pet: profile.pet ?? '',
        },
      })
      heartbeat = setInterval(() => {
        send({ v: PROTOCOL_VERSION, type: 'ping', payload: { at: Date.now() } })
      }, HEARTBEAT_MS)
      heartbeat.unref?.()
    }

    socket.onmessage = (event) => {
      let frame
      try {
        frame = JSON.parse(typeof event.data === 'string' ? event.data : '')
      } catch {
        return
      }
      if (!isEnvelope(frame)) return
      dispatch(frame)
    }

    socket.onclose = () => {
      clearInterval(heartbeat)
      heartbeat = null
      socket = null
      if (!stopped) {
        setStatus('offline')
        scheduleReconnect()
      }
    }

    socket.onerror = (event) => {
      const message = event?.message ?? 'websocket error'
      setStatus('error', String(message))
    }
  }

  function dispatch(frame) {
    switch (frame.type) {
      case 'welcome': {
        const peers = Array.isArray(frame.payload?.peers) ? frame.payload.peers : []
        onWelcome?.({ peers, room })
        return
      }
      case 'presence':
        onPresence?.(frame)
        return
      case 'peer-leave':
        onPeerLeave?.(String(frame.payload?.deviceId ?? ''))
        return
      case 'interaction':
        onInteraction?.(frame)
        return
      case 'reaction':
        onReaction?.(frame)
        return
      case 'chat':
        onChat?.(frame)
        return
      case 'chat-reply':
        onChatReply?.(frame)
        return
      case 'error':
        setStatus('error', String(frame.payload?.message ?? 'relay error'))
        return
      default:
        return
    }
  }

  function send(frame) {
    if (!socket || socket.readyState !== 1) return false
    try {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, from: deviceId, ...frame }))
      return true
    } catch {
      return false
    }
  }

  function connectNow() {
    stopped = false
    attempt = 0
    clearTimeout(reconnectTimer)
    if (socket) return
    connect()
  }

  function close() {
    stopped = true
    clearInterval(heartbeat)
    heartbeat = null
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    try {
      socket?.close()
    } catch {
      /* ignore */
    }
    socket = null
    setStatus('idle')
  }

  return {
    connect: connectNow,
    close,
    send,
    get status() {
      return status
    },
    get lastError() {
      return lastError
    },
    get room() {
      return room
    },
  }
}
