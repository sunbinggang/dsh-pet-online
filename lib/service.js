/**
 * 联机服务（host 半侧编排层）。
 *
 * 一条数据链路：
 *   dsh-pet /state 长轮询 → 摘要 → relay presence 帧 → 其它设备
 *   其它设备 interaction 帧 → 意图翻译 → 本机 dsh-pet /broadcast /anim /throw
 *
 * 这里同时是面板 API 的数据源：snapshot() 返回面板要的一切（不与 dsh-pet 抢 /state）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  CHAT_MAX_CHARS,
  CHAT_PER_MINUTE,
  INTERACTION_PER_MINUTE,
  INTENTS,
  INTENT_SPECS,
  PROTOCOL_VERSION,
  clampInt,
  fillTemplate,
  isChat,
  isInteraction,
  normalizeCode,
  newPairingCode,
  sanitizeText,
  summarizePet,
} from './protocol.js'
import { createLocalBridge } from './local-bridge.js'
import { createRelayClient } from './relay-client.js'
import { createRelayServer } from '../relay/server.mjs'

const DEFAULT_CONFIG = {
  enabled: true,
  relayUrl: 'ws://127.0.0.1:7420/ws',
  autoRelay: true,
  nickname: '',
  acceptInteractions: true,
  acceptChat: true,
  shareBubbles: true,
  pairCode: '',
  maxPeers: 8,
}

const PRESENCE_MIN_INTERVAL_MS = 1_000
const PRESENCE_KEEPALIVE_MS = 15_000
const PAIRING_TTL_MS = 10 * 60 * 1000

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export function createOnlineService(ctx) {
  const root = join(dshHome(), 'dsh-pet-online')
  const configPath = join(root, 'config.json')
  const devicePath = join(root, 'device.json')

  const bridge = createLocalBridge(ctx)

  let config = { ...DEFAULT_CONFIG }
  let deviceId = ''
  let relay = null
  let localRelay = null
  let localRelayPort = 0
  let stopped = false
  let loopTimer = null
  let lastState = { counter: 0, pets: {}, sections: {} }
  let lastPresenceAt = 0
  let lastPresenceHash = ''
  let lastSendAt = 0

  const peers = new Map()
  const seenInteractions = new Set()
  const seenOrder = []
  const rateBuckets = new Map()
  const reactions = []
  /** 跨机聊天记录：peerId → 最近 30 条 */
  const chats = new Map()

  const counters = { sent: 0, received: 0, interactionsIn: 0, interactionsOut: 0, dropped: 0 }
  const pairing = { code: '', expiresAt: 0 }

  let selfPets = []
  let lastError = ''
  /** 覆盖层用的版本号：任何 peer 状态变化都 +1，客户端长轮询据此收敛。 */
  let version = 0
  const waiters = new Set()

  function bump() {
    version += 1
    for (const wake of [...waiters]) wake()
    waiters.clear()
  }

  async function load() {
    await mkdir(root, { recursive: true })
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(configPath, 'utf8')) }
    } catch {
      /* 首次运行：用默认值 */
    }
    try {
      const saved = JSON.parse(await readFile(devicePath, 'utf8'))
      deviceId = typeof saved.id === 'string' ? saved.id : ''
    } catch {
      /* 首次运行：下面生成 */
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(deviceId)) {
      deviceId = 'dev-' + randomUUID().replace(/-/g, '').slice(0, 16)
      await writeFile(devicePath, JSON.stringify({ id: deviceId }, null, 2), 'utf8')
    }
    if (config.pairCode && normalizeCode(config.pairCode) !== '') {
      pairing.code = normalizeCode(config.pairCode)
      pairing.expiresAt = 0
    }
  }

  async function persistConfig() {
    try {
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')
    } catch (error) {
      lastError = 'config-write: ' + (error instanceof Error ? error.message : String(error))
    }
  }

  function profile() {
    const pet = selfPets[0]
    return {
      name: sanitizeText(config.nickname, 24) || (pet ? pet.name : '桌宠'),
      pet: pet ? pet.id : '',
    }
  }

  function isLocalRelayUrl(url) {
    try {
      const parsed = new URL(url)
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1'
    } catch {
      return false
    }
  }

  /** 默认地址指向本机时，自动把 relay 起在本机（端口被占用说明已有 relay，直接跳过）。 */
  async function ensureLocalRelay() {
    if (!config.enabled || config.autoRelay === false) {
      stopLocalRelay()
      return
    }
    if (!isLocalRelayUrl(config.relayUrl)) {
      stopLocalRelay()
      return
    }
    let port
    try {
      port = Number(new URL(config.relayUrl).port || 80)
    } catch {
      return
    }
    if (localRelay && localRelayPort === port) return
    if (localRelay && localRelayPort !== port) stopLocalRelay()
    const server = createRelayServer()
    await new Promise((resolve) => {
      server.once('error', (error) => {
        if (error.code !== 'EADDRINUSE') lastError = 'relay-local: ' + error.message
        resolve()
      })
      server.listen(port, '0.0.0.0', () => resolve())
    })
    if (server.listening) {
      localRelay = server
      localRelayPort = port
    }
  }

  function stopLocalRelay() {
    if (!localRelay) return
    try {
      localRelay.closeAllConnections?.()
      localRelay.close()
    } catch {
      /* ignore */
    }
    localRelay = null
    localRelayPort = 0
  }

  function attachRelay() {
    if (relay) {
      relay.close()
      relay = null
    }
    if (!config.enabled || !config.relayUrl || pairing.code === '') return
    relay = createRelayClient({
      url: config.relayUrl,
      code: pairing.code,
      deviceId,
      profile: profile(),
      onStatus: ({ status, error }) => {
        if (status === 'error') lastError = error
        // 一上线就立刻发一次 presence：否则对方要等下一次状态变化/15s 保活才看到宠物
        if (status === 'online') publishPresence(true).catch(() => {})
      },
      onWelcome: ({ peers: list }) => {
        for (const peer of list) upsertPeer(peer)
        bump()
        publishPresence(true).catch(() => {})
      },
      onPresence: (frame) => {
        counters.received += 1
        const isNew = upsertPeer(frame.payload?.device ?? {})
        const summary = frame.payload?.pets
        const peerId = String(frame.payload?.device?.deviceId ?? frame.payload?.device?.id ?? '')
        const peer = peers.get(peerId)
        if (peer && Array.isArray(summary)) {
          peer.pets = summary.filter((p) => p && typeof p.id === 'string')
          peer.lastSeen = Date.now()
        }
        bump()
        // 新对端上线时立刻回一帧 presence：不等下一次状态变化，对方能马上看到我的宠物
        if (isNew) publishPresence(true).catch(() => {})
      },
      onPeerLeave: (id) => {
        peers.delete(id)
        bump()
      },
      onInteraction: (frame) => {
        void handleIncomingInteraction(frame)
      },
      onChat: (frame) => {
        void handleIncomingChat(frame)
      },
      onChatReply: (frame) => {
        const payload = frame.payload ?? {}
        const text = sanitizeText(payload.text, CHAT_MAX_CHARS)
        if (text === '') return
        pushChat(String(frame.from ?? ''), { from: 'them', text, at: Date.now() })
        bump()
      },
      onReaction: (frame) => {
        counters.received += 1
        const payload = frame.payload ?? {}
        reactions.unshift({
          msgId: String(payload.msgId ?? ''),
          to: String(frame.from ?? ''),
          ok: payload.ok === true,
          reason: String(payload.reason ?? ''),
          mode: String(payload.mode ?? 'full'),
          at: Date.now(),
        })
        if (reactions.length > 20) reactions.length = 20
      },
    })
    relay.connect()
  }

  function upsertPeer(raw) {
    const id = String(raw?.deviceId ?? raw?.id ?? '')
    if (!id || id === deviceId) return false
    const existing = peers.get(id)
    peers.set(id, {
      deviceId: id,
      name: sanitizeText(raw.name, 24) || existing?.name || '对方桌宠',
      pet: sanitizeText(raw.pet, 48) || existing?.pet || '',
      pets: existing?.pets ?? [],
      work: existing?.work ?? null,
      lastSeen: Date.now(),
    })
    trimPeers()
    return existing === undefined
  }

  function trimPeers() {
    const max = clampInt(config.maxPeers, 8, 1, 32)
    while (peers.size > max) {
      let oldest = null
      for (const peer of peers.values()) {
        if (oldest === null || peer.lastSeen < oldest.lastSeen) oldest = peer
      }
      if (oldest === null) break
      peers.delete(oldest.deviceId)
    }
  }

  function canRate(key, max) {
    const now = Date.now()
    let bucket = rateBuckets.get(key)
    if (!bucket || now - bucket.at > 60_000) {
      bucket = { at: now, count: 0 }
      rateBuckets.set(key, bucket)
    }
    if (bucket.count >= max) return false
    bucket.count += 1
    return true
  }

  function canInteract(peerId) {
    return canRate('i:' + peerId, INTERACTION_PER_MINUTE)
  }

  function pushChat(peerId, entry) {
    const list = chats.get(peerId) ?? []
    list.push(entry)
    if (list.length > 30) list.splice(0, list.length - 30)
    chats.set(peerId, list)
    bump()
  }

  function rememberInteraction(msgId) {
    if (seenInteractions.has(msgId)) return false
    seenInteractions.add(msgId)
    seenOrder.push(msgId)
    if (seenOrder.length > 200) {
      const gone = seenOrder.shift()
      seenInteractions.delete(gone)
    }
    return true
  }

  /** 用户是否正专注在某个会话里：dsh-pet 的 focusSession 叶子有近期写入即算忙。 */
  function focusBusy() {
    const data = lastState.sections.focusSession?.data
    if (!data || typeof data !== 'object') return false
    const ts = Number(data.ts)
    if (!Number.isFinite(ts)) return true
    return Date.now() - ts < 5 * 60_000
  }

  async function handleIncomingInteraction(frame) {
    if (!isInteraction(frame)) return
    const payload = frame.payload ?? {}
    const msgId = String(payload.msgId)
    const intent = payload.intent
    const fromId = String(frame.from ?? '')
    const fromName = sanitizeText(payload.fromName, 24) || peers.get(fromId)?.name || '对方桌宠'
    counters.received += 1
    if (!rememberInteraction(msgId)) {
      counters.dropped += 1
      return
    }
    if (!config.acceptInteractions) {
      replyReaction(fromId, msgId, false, 'declined', fromName)
      return
    }
    if (!canInteract(fromId)) {
      replyReaction(fromId, msgId, false, 'rate-limited', fromName)
      return
    }
    const spec = INTENT_SPECS[intent]
    const note = sanitizeText(payload.note, 40)
    const vars = { from: fromName, name: fromName, note }
    const busy = focusBusy()
    try {
      const result = await bridge.applyIntent(intent, { ...spec, text: fillTemplate(spec.text, vars) }, vars, {
        bubbleOnly: busy,
      })
      counters.interactionsIn += 1
      replyReaction(fromId, msgId, result.ok === true, result.ok ? '' : result.reason ?? 'failed', fromName, busy)
    } catch (error) {
      replyReaction(fromId, msgId, false, error instanceof Error ? error.message : String(error), fromName, busy)
    }
  }

  function replyReaction(to, msgId, ok, reason, fromName, busy = false) {
    relay?.send({
      v: PROTOCOL_VERSION,
      type: 'reaction',
      to,
      payload: { msgId, ok, reason, fromName, mode: busy ? 'bubble' : 'full', at: Date.now() },
    })
  }

  /** 收到对方的跨机聊天：让本机宠物用自己的 LLM 人设回一句。 */
  async function handleIncomingChat(frame) {
    if (!isChat(frame)) return
    const p = frame.payload
    const msgId = String(p.msgId)
    const fromId = String(frame.from ?? '')
    const fromName = sanitizeText(p.fromName, 24) || peers.get(fromId)?.name || '对方桌宠'
    const text = sanitizeText(p.text, CHAT_MAX_CHARS)
    if (!rememberInteraction(msgId)) return
    counters.received += 1
    if (!config.acceptChat) {
      relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: 'declined' } })
      return
    }
    if (!canRate('c:' + fromId, CHAT_PER_MINUTE)) {
      relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: 'rate-limited' } })
      return
    }
    const { pets } = await bridge.localPets()
    const pet = bridge.pickPet(pets)
    if (!pet) {
      relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: 'no-pet' } })
      return
    }
    try {
      const result = await bridge.chat(pet.id, text)
      if (!result.ok) {
        relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: result.reason } })
        return
      }
      const reply = sanitizeText(result.text, CHAT_MAX_CHARS) || '……'
      pushChat(fromId, { from: 'them', text, at: Date.now() })
      relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: true, text: reply } })
      counters.interactionsIn += 1
    } catch (error) {
      relay?.send({
        v: PROTOCOL_VERSION,
        type: 'chat-reply',
        to: fromId,
        payload: { msgId, ok: false, reason: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /** 面板发起的跨机聊天。 */
  async function chatTo(req) {
    const to = String(req.to ?? '')
    const text = sanitizeText(req.text, CHAT_MAX_CHARS)
    if (!peers.has(to)) return { ok: false, reason: 'unknown-peer' }
    if (text === '') return { ok: false, reason: 'empty-text' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    if (!canRate('oc:' + to, CHAT_PER_MINUTE)) return { ok: false, reason: 'rate-limited' }
    const msgId = 'c-' + randomUUID().slice(0, 8)
    const sent = relay.send({
      v: PROTOCOL_VERSION,
      type: 'chat',
      to,
      payload: { msgId, text, fromName: profile().name },
    })
    if (!sent) return { ok: false, reason: 'send-failed' }
    pushChat(to, { from: 'me', text, at: Date.now() })
    counters.sent += 1
    return { ok: true, msgId }
  }

  /** 把当前 state 折成 presence 摘要。 */
  async function buildPresence() {
    const { pets: localPets } = await bridge.localPets()
    const pets = []
    for (const pet of localPets.slice(0, 5)) {
      const leaves = lastState.pets[pet.id] ?? {}
      const say = leaves.say?.data
      const anim = leaves.anim?.data
      const pos = leaves.position?.data
      const sleep = leaves.sleep?.data
      pets.push(
        summarizePet(
          {
            ...pet,
            anim: anim?.name ?? anim?.url ?? '',
            bubble: say?.text ?? '',
            facing: anim?.facing,
            sleeping: sleep?.sleeping === true,
            x: pos?.x,
            y: pos?.y,
          },
          { shareBubbles: config.shareBubbles },
        ),      )
    }
    selfPets = localPets
    const work = lastState.sections.workStatus?.data
    return {
      device: { id: deviceId, deviceId, ...profile() },
      pets,
      work: work && typeof work === 'object' ? { level: work.level ?? 0, text: sanitizeText(work.text ?? '', 40) } : null,
      at: Date.now(),
    }
  }

  async function publishPresence(force = false) {
    if (!relay || relay.status !== 'online') return
    const now = Date.now()
    if (!force && now - lastPresenceAt < PRESENCE_MIN_INTERVAL_MS) return
    lastPresenceAt = now
    const presence = await buildPresence()
    const hash = JSON.stringify(presence)
    if (!force && hash === lastPresenceHash) {
      if (now - lastSendAt < PRESENCE_KEEPALIVE_MS) return
    }
    lastPresenceHash = hash
    lastSendAt = now
    if (relay.send({ v: PROTOCOL_VERSION, type: 'presence', payload: presence })) counters.sent += 1
  }

  async function stateLoop() {
    let since = 0
    while (!stopped) {
      let snap = null
      try {
        snap = await bridge.getState(since)
      } catch {
        snap = null
      }
      if (stopped) return
      if (snap === null) {
        await new Promise((r) => setTimeout(r, 2_000))
        continue
      }
      since = snap.counter
      lastState = snap
      publishPresence().catch(() => {})
    }
  }

  async function refreshSelf() {
    try {
      const { pets } = await bridge.localPets()
      selfPets = pets
    } catch {
      /* dsh-pet 还没起来：下一拍再试 */
    }
  }

  function start() {
    stopped = false
    load()
      .then(async () => {
        await ensureLocalRelay()
        attachRelay()
        refreshSelf()
        stateLoop().catch(() => {})
        loopTimer = setInterval(() => publishPresence().catch(() => {}), PRESENCE_KEEPALIVE_MS)
        loopTimer.unref?.()
        // 自己宠物的清单不依赖 relay：面板/投影在未联机时也要能看到本机宠物
        const selfTimer = setInterval(() => refreshSelf(), 15_000)
        selfTimer.unref?.()
      })
      .catch((error) => {
        lastError = error instanceof Error ? error.message : String(error)
      })
  }

  function stop() {
    stopped = true
    clearInterval(loopTimer)
    loopTimer = null
    relay?.close()
    relay = null
    stopLocalRelay()
  }

  /** 覆盖层快照：远端设备 + 它们的宠物（含动作/气泡/位置）。 */
  function overlay() {
    return {
      ok: true,
      version,
      self: { pets: selfPets.map((p) => ({ id: p.id, name: p.name, size: p.size, assetRoot: p.assetRoot })) },
      peers: [...peers.values()].map((p) => ({
        deviceId: p.deviceId,
        name: p.name,
        pets: p.pets,
        lastSeen: p.lastSeen,
        online: Date.now() - p.lastSeen < 120_000,
      })),
    }
  }

  /** 长轮询：版本没变就挂起，变了或超时返回最新覆盖层快照。 */
  function waitForChange(since, timeoutMs = 10_000) {
    if (version !== since) return Promise.resolve(overlay())
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        resolve(overlay())
      }
      const timer = setTimeout(() => {
        waiters.delete(wake)
        resolve(overlay())
      }, Math.max(0, Math.min(timeoutMs, 10_000)))
      waiters.add(wake)
    })
  }

  function snapshot() {
    return {
      ok: true,
      version: PROTOCOL_VERSION,
      device: { id: deviceId, nickname: config.nickname },
      enabled: config.enabled === true,
      relay: {
        url: config.relayUrl,
        status: relay?.status ?? (config.enabled ? 'offline' : 'idle'),
        room: relay?.room ?? '',
        error: relay?.lastError || lastError,
      },
      pairing: { code: pairing.code, expiresAt: pairing.expiresAt },
      self: { pets: selfPets },
      peers: [...peers.values()]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .map((p) => ({
          deviceId: p.deviceId,
          name: p.name,
          pet: p.pet,
          lastSeen: p.lastSeen,
          online: Date.now() - p.lastSeen < 120_000,
          pets: p.pets,
          work: p.work,
        })),
      config: { ...config, pairCode: undefined },
      counters: { ...counters },
      reactions,
      chats: Object.fromEntries([...chats.entries()].map(([id, list]) => [id, list.slice(-10)])),
    }
  }

  async function setConfig(patch) {
    if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled
    if (typeof patch.nickname === 'string') config.nickname = sanitizeText(patch.nickname, 24)
    if (typeof patch.acceptInteractions === 'boolean') config.acceptInteractions = patch.acceptInteractions
    if (typeof patch.acceptChat === 'boolean') config.acceptChat = patch.acceptChat
    if (typeof patch.shareBubbles === 'boolean') config.shareBubbles = patch.shareBubbles
    if (typeof patch.maxPeers === 'number') config.maxPeers = clampInt(patch.maxPeers, 8, 1, 32)
    if (typeof patch.relayUrl === 'string' && /^wss?:\/\//.test(patch.relayUrl)) {
      if (patch.relayUrl !== config.relayUrl && !isLocalRelayUrl(patch.relayUrl)) stopLocalRelay()
      config.relayUrl = patch.relayUrl
    }
    await persistConfig()
    await ensureLocalRelay()
    attachRelay()
    await publishPresence(true)
    return { ok: true }
  }

  async function pair(rawCode) {
    const code = normalizeCode(rawCode)
    if (code === '') return { ok: false, reason: 'invalid-code' }
    pairing.code = code
    pairing.expiresAt = Date.now() + PAIRING_TTL_MS
    config.pairCode = code
    await persistConfig()
    await ensureLocalRelay()
    attachRelay()
    return { ok: true, code, room: relay?.room ?? '' }
  }

  async function newPairing() {
    const code = newPairingCode()
    pairing.code = code
    pairing.expiresAt = Date.now() + PAIRING_TTL_MS
    config.pairCode = code
    await persistConfig()
    await ensureLocalRelay()
    attachRelay()
    return { ok: true, code, expiresAt: pairing.expiresAt }
  }

  async function leave() {
    pairing.code = ''
    pairing.expiresAt = 0
    config.pairCode = ''
    await persistConfig()
    relay?.close()
    relay = null
    peers.clear()
    return { ok: true }
  }

  /** 面板点「打招呼/投喂」：把意图发给某台设备。 */
  async function interact(req) {
    const to = String(req.to ?? '')
    const intent = String(req.intent ?? '')
    if (!peers.has(to)) return { ok: false, reason: 'unknown-peer' }
    if (!INTENTS.includes(intent)) return { ok: false, reason: 'invalid-intent' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    if (!canInteract('out:' + to)) return { ok: false, reason: 'rate-limited' }
    const msgId = 'i-' + randomUUID().slice(0, 8)
    const sent = relay.send({
      v: PROTOCOL_VERSION,
      type: 'interaction',
      to,
      payload: {
        msgId,
        intent,
        note: sanitizeText(req.note, 40),
        fromName: profile().name,
      },
    })
    if (!sent) return { ok: false, reason: 'send-failed' }
    counters.interactionsOut += 1
    counters.sent += 1
    return { ok: true, msgId }
  }

  return {
    start,
    stop,
    snapshot,
    overlay,
    waitForChange,
    setConfig,
    pair,
    newPairing,
    leave,
    interact,
    chat: chatTo,
    get deviceId() {
      return deviceId
    },
  }
}
