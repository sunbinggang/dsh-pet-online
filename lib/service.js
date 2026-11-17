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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createUpdateChecker } from './update.js'
import { applyUpdate } from './update-apply.js'
import { fileURLToPath } from 'node:url'

/** 本包版本：模块加载时同步读，面板/更新检测立刻可用。 */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PACKAGE_VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '')
  } catch {
    return ''
  }
})()
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
  sanitizeTrack,
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
  acceptRawChat: true,
  /** 对端分享音乐时，是否允许本机直接播放同一首（默认关，需用户勾选同意）。 */
  acceptRemoteMusic: false,
  /** 跟随房间同步播放：自己切歌时广播，收到对端切歌时交给本机 dsh-music-player 播。 */
  syncMusic: true,
  shareBubbles: true,
  pairCode: '',
  maxPeers: 8,
  updateCheck: true,
}

/** 更新检测周期：6 小时一次（失败也不重试，等下一拍）。 */
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
const UPDATE_REPO = 'sunbinggang/dsh-pet-online'

const PRESENCE_MIN_INTERVAL_MS = 1_000
const PRESENCE_KEEPALIVE_MS = 15_000
const PAIRING_TTL_MS = 10 * 60 * 1000
/** 本机播放变化轮询周期：dsh-music-player 的 prefs 里曲目 id 变了就广播。 */
const MUSIC_WATCH_MS = 2_500

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
  /** 收到的音乐分享：最近的 5 条 {seq, track, fromId, fromName, at} */
  const musicShares = []
  /** 客户端待播放的曲目（面板手动点播或勾选自动播放）。 */
  let playRequest = { seq: 0, shareSeq: 0, track: null, fromName: '', at: 0 }
  let playSeq = 0
  let musicSeq = 0
  /** 房间同步播放：{seq, track, fromName, at}，客户端据此让 dsh-music-player 切歌。 */
  let musicSync = { seq: 0, track: null, fromName: '', at: 0 }
  let musicSyncSeq = 0
  let musicWatchTimer = null
  /** 上一次观察到的本机曲目 key（source:id），用来判断「切歌了」。 */
  let lastLocalMusicKey = ''
  let suppressMusicKey = ''
  let suppressMusicUntil = 0

  const counters = { sent: 0, received: 0, interactionsIn: 0, interactionsOut: 0, dropped: 0 }
  const pairing = { code: '', expiresAt: 0 }

  let selfPets = []
  let lastError = ''
  /** 本机宠物气泡的到期跟踪：petId → { counter, at }。dsh-pet 的气泡默认 10s 收起。 */
  const bubbleSeen = new Map()
  let bubbleTimer = null
  const BUBBLE_TTL_MS = 10_000
  /** 本机客户端探测到的「当前正在播的动画」：presence 用它覆盖状态叶子里的旧动作。 */
  let localAction = { anim: '', at: 0 }
  const LOCAL_ACTION_TTL_MS = 8000
  let localVersion = PACKAGE_VERSION
  let updateChecker = null
  let updateTimer = null
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
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true
      // 中继地址填本机的局域网 IP 时也要能自动起中继：否则面板会说「中继未连接」，
      // 而用户按提示把地址改成自己的 10.x/192.168.x 后反而不会自动启动。
      for (const list of Object.values(networkInterfaces())) {
        for (const item of list ?? []) {
          if (item.address === host) return true
        }
      }
      return false
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
      onMusicSync: (frame) => {
        handleMusicSync(frame)
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
    const track = intent === 'music' ? sanitizeTrack(payload.track) : null
    const vars = { from: fromName, name: fromName, note }
    const busy = focusBusy()
    try {
      const result = await bridge.applyIntent(intent, { ...spec, text: fillTemplate(spec.text, vars) }, vars, {
        bubbleOnly: busy,
      })
      counters.interactionsIn += 1
      if (track) recordMusicShare(track, fromId, fromName)
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

  /** 记下一条对端分享的曲目；用户勾选同意后，同时排队让本机播放同一首。 */
  function recordMusicShare(track, fromId, fromName) {
    musicSeq += 1
    const share = { seq: musicSeq, track, fromId, fromName, at: Date.now() }
    musicShares.unshift(share)
    if (musicShares.length > 5) musicShares.pop()
    if (config.acceptRemoteMusic) {
      playSeq += 1
      playRequest = { seq: playSeq, shareSeq: share.seq, track, fromName, at: share.at }
    }
    bump()
  }

  /** 面板点「播放同一首」：把某条分享排队给浏览器半侧播放。 */
  function requestMusicPlay(seq) {
    const wanted = Number(seq)
    const share = musicShares.find((item) => item.seq === wanted) ?? musicShares[0]
    if (!share) return { ok: false, reason: 'no-share' }
    playSeq += 1
    playRequest = { seq: playSeq, shareSeq: share.seq, track: share.track, fromName: share.fromName, at: Date.now() }
    bump()
    return { ok: true }
  }

  function musicKeyOf(track) {
    return track && typeof track.id === 'string' && track.id !== '' ? track.source + ':' + track.id : ''
  }

  function broadcastMusicSync(track) {
    if (!relay || relay.status !== 'online') return false
    if (onlinePeerIds().length === 0) return false
    const sent = relay.send({ v: PROTOCOL_VERSION, type: 'music-sync', payload: { track, at: Date.now() } })
    if (sent) counters.sent += 1
    return sent
  }

  /** 本机切歌检测：dsh-music-player 的 prefs 里 source:id 变了就广播给房间。 */
  async function watchMusicOnce() {
    if (stopped || config.syncMusic === false) return
    if (!relay || relay.status !== 'online' || onlinePeerIds().length === 0) return
    let now
    try {
      now = await bridge.musicNow()
    } catch {
      return
    }
    if (!now || now.ok !== true || !now.track) return
    const track = sanitizeTrack(now.track)
    if (track === null) return
    const key = musicKeyOf(track)
    if (key === '') return
    if (key === lastLocalMusicKey) return
    lastLocalMusicKey = key
    // 刚被远端同步过：本机曲目变化是「跟播」的结果，不要再反弹回房间。
    if (Date.now() < suppressMusicUntil && key === suppressMusicKey) return
    broadcastMusicSync(track)
  }

  /** 收到对端切歌：记下最新曲目，客户端会把它交给本机 dsh-music-player 播。 */
  function handleMusicSync(frame) {
    if (config.syncMusic === false) return
    const track = sanitizeTrack(frame.payload?.track)
    if (track === null) return
    const fromId = String(frame.from ?? '')
    const fromName = sanitizeText(peers.get(fromId)?.name ?? frame.payload?.fromName ?? '', 24) || '对方'
    const key = musicKeyOf(track)
    // 记住这已经是对端带来的曲目，本机随后写进 prefs 的变化不再广播回去。
    if (key !== '') {
      lastLocalMusicKey = key
      suppressMusicKey = key
      suppressMusicUntil = Date.now() + 10_000
    }
    musicSyncSeq += 1
    musicSync = { seq: musicSyncSeq, track, fromName, at: Date.now() }
    bump()
  }

  /** 面板「同步当前播放」：立即把本机正在播的曲子推给房间（不等下一拍轮询）。
   *  优先用客户端从页面里读到的曲目（播放器写宿主 prefs 有防抖，宿主快照可能还是旧的）。 */
  async function syncMusicNow(inputTrack, options = {}) {
    let track = sanitizeTrack(inputTrack)
    if (track === null) {
      let now
      try {
        now = await bridge.musicNow()
      } catch {
        return { ok: false, reason: 'music-unavailable' }
      }
      if (!now || now.ok !== true || !now.track) return { ok: false, reason: now?.reason || 'not-playing' }
      track = sanitizeTrack(now.track)
      if (track === null) return { ok: false, reason: 'invalid-track' }
    }
    if (options.auto === true && config.syncMusic === false) return { ok: false, reason: 'disabled' }
    if (!broadcastMusicSync(track)) return { ok: false, reason: 'relay-offline' }
    lastLocalMusicKey = musicKeyOf(track)
    return { ok: true, sent: onlinePeerIds().length, track }
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
    // 纯文本消息：直接展示，不经过本机宠物的 LLM（不消耗 token）。
    if (p.raw === true) {
      if (!config.acceptRawChat) {
        relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: 'declined' } })
        return
      }
      if (!canRate('c:' + fromId, CHAT_PER_MINUTE)) {
        relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: false, reason: 'rate-limited' } })
        return
      }
      pushChat(fromId, { from: 'them', text, at: Date.now(), raw: true })
      // 纯文字也要让对方宠物冒出来：直接广播到本机宠物气泡，不经过 LLM。
      try {
        await bridge.say(text)
      } catch {
        /* 气泡失败不影响消息本身 */
      }
      relay?.send({ v: PROTOCOL_VERSION, type: 'chat-reply', to: fromId, payload: { msgId, ok: true, ack: true } })
      counters.interactionsIn += 1
      return
    }
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

  /** 面板发起的跨机聊天：raw=true 直接发文本，false 让对端宠物用 LLM 回。 */
  async function chatTo(req) {
    const to = String(req.to ?? '')
    const text = sanitizeText(req.text, CHAT_MAX_CHARS)
    const raw = req.raw === true
    if (!peers.has(to)) return { ok: false, reason: 'unknown-peer' }
    if (text === '') return { ok: false, reason: 'empty-text' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    if (!canRate('oc:' + to, CHAT_PER_MINUTE)) return { ok: false, reason: 'rate-limited' }
    const msgId = 'c-' + randomUUID().slice(0, 8)
    const sent = relay.send({
      v: PROTOCOL_VERSION,
      type: 'chat',
      to,
      payload: { msgId, text, fromName: profile().name, ...(raw ? { raw: true } : {}) },
    })
    if (!sent) return { ok: false, reason: 'send-failed' }
    pushChat(to, { from: 'me', text, at: Date.now(), raw })
    counters.sent += 1
    return { ok: true, msgId }
  }

  /** 把当前 state 折成 presence 摘要。 */
  async function buildPresence() {
    const { pets: localPets } = await bridge.localPets()
    const pets = []
    for (const [index, pet] of localPets.slice(0, 5).entries()) {
      const leaves = lastState.pets[pet.id] ?? {}
      const say = leaves.say?.data
      const anim = leaves.anim?.data
      const pos = leaves.position?.data
      const sleep = leaves.sleep?.data
      // 气泡跟 dsh-pet 一样 10s 收起：按 say 叶子的 counter 记首次出现时间，
      // 过期后 presence 里不再带气泡，投影侧的那只才会一起消失。
      const sayCounter = leaves.say?.counter ?? 0
      const previous = bubbleSeen.get(pet.id)
      if (!previous || previous.counter !== sayCounter) bubbleSeen.set(pet.id, { counter: sayCounter, at: Date.now() })
      const seen = bubbleSeen.get(pet.id)
      const bubbleFresh = seen !== undefined && Date.now() - seen.at < BUBBLE_TTL_MS
      // 本机客户端刚探测到的动画优先：随机动作/点击动画不会写 /state，只能这样同步过去
      const liveAnim =
        index === 0 && localAction.anim !== '' && Date.now() - localAction.at < LOCAL_ACTION_TTL_MS
          ? localAction.anim
          : anim?.name ?? anim?.url ?? ''
      pets.push(
        summarizePet(
          {
            ...pet,
            anim: liveAnim,
            bubble: bubbleFresh ? say?.text ?? '' : '',
            bubbleImage: bubbleFresh && typeof say?.image === 'string' ? say.image : '',
            facing: anim?.facing,
            sleeping: sleep?.sleeping === true,
            x: pos?.x,
            y: pos?.y,
          },
          { shareBubbles: config.shareBubbles },
        ),
      )
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
    scheduleBubbleExpiry()
  }

  /** 有气泡正在展示时，安排一次到期后的 presence 推送，让投影侧同步收起。 */
  function scheduleBubbleExpiry() {
    if (bubbleTimer !== null) return
    const now = Date.now()
    let delay = Number.POSITIVE_INFINITY
    for (const seen of bubbleSeen.values()) {
      const remaining = seen.at + BUBBLE_TTL_MS - now
      if (remaining > 0 && remaining < delay) delay = remaining
    }
    if (!Number.isFinite(delay)) return
    bubbleTimer = setTimeout(() => {
      bubbleTimer = null
      publishPresence(true).catch(() => {})
    }, delay + 60)
    bubbleTimer.unref?.()
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

  function scheduleUpdateCheck() {
    if (!localVersion) return
    if (!updateChecker) {
      updateChecker = createUpdateChecker({ currentVersion: localVersion, repo: UPDATE_REPO })
    }
    if (config.updateCheck === false) return
    updateChecker.check().catch(() => {})
    if (updateTimer) clearInterval(updateTimer)
    updateTimer = setInterval(() => {
      updateChecker.check().catch(() => {})
    }, UPDATE_INTERVAL_MS)
    updateTimer.unref?.()
  }

  async function checkUpdate() {
    if (!updateChecker) {
      updateChecker = createUpdateChecker({ currentVersion: localVersion || '0.0.0', repo: UPDATE_REPO })
    }
    await updateChecker.check()
    return { ok: true, ...updateChecker.state }
  }

  /** 一键更新：下载 Release 资产并覆盖本包目录（重启 DSH 生效）。 */
  async function applyUpdateNow() {
    const result = await applyUpdate({
      currentVersion: localVersion,
      repo: UPDATE_REPO,
      rootDir: PACKAGE_ROOT,
      backupRoot: join(root, 'backups'),
    })
    if (result.ok === true) {
      updateChecker = createUpdateChecker({ currentVersion: result.updatedTo, repo: UPDATE_REPO })
      await updateChecker.check()
    }
    return result
  }

  function start() {
    stopped = false
    load()
      .then(async () => {
        await ensureLocalRelay()
        attachRelay()
        refreshSelf()
        scheduleUpdateCheck()
        stateLoop().catch(() => {})
        loopTimer = setInterval(() => publishPresence().catch(() => {}), PRESENCE_KEEPALIVE_MS)
        loopTimer.unref?.()
        musicWatchTimer = setInterval(() => watchMusicOnce().catch(() => {}), MUSIC_WATCH_MS)
        musicWatchTimer.unref?.()
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
    clearInterval(updateTimer)
    updateTimer = null
    clearInterval(musicWatchTimer)
    musicWatchTimer = null
    if (bubbleTimer !== null) clearTimeout(bubbleTimer)
    bubbleTimer = null
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
      music: playRequest.track ? playRequest : null,
      musicSync: musicSync.track ? musicSync : null,
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
      room: { members: onlinePeerIds().length + 1, capacity: 8 },
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
      musicShares: musicShares.map((item) => ({ seq: item.seq, track: item.track, fromName: item.fromName, at: item.at })),
      playRequest,
      musicSync: musicSync.track ? musicSync : null,
      pluginVersion: localVersion,
      update: updateChecker ? updateChecker.state : null,
    }
  }

  async function setConfig(patch) {
    const prevEnabled = config.enabled
    const prevRelayUrl = config.relayUrl
    if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled
    if (typeof patch.nickname === 'string') config.nickname = sanitizeText(patch.nickname, 24)
    if (typeof patch.acceptInteractions === 'boolean') config.acceptInteractions = patch.acceptInteractions
    if (typeof patch.acceptChat === 'boolean') config.acceptChat = patch.acceptChat
    if (typeof patch.acceptRawChat === 'boolean') config.acceptRawChat = patch.acceptRawChat
    if (typeof patch.acceptRemoteMusic === 'boolean') config.acceptRemoteMusic = patch.acceptRemoteMusic
    if (typeof patch.syncMusic === 'boolean') config.syncMusic = patch.syncMusic
    if (typeof patch.updateCheck === 'boolean') {
      config.updateCheck = patch.updateCheck
      if (patch.updateCheck) checkUpdate().catch(() => {})
    }
    if (typeof patch.shareBubbles === 'boolean') config.shareBubbles = patch.shareBubbles
    if (typeof patch.maxPeers === 'number') config.maxPeers = clampInt(patch.maxPeers, 8, 1, 32)
    if (typeof patch.relayUrl === 'string' && /^wss?:\/\//.test(patch.relayUrl)) {
      if (patch.relayUrl !== config.relayUrl && !isLocalRelayUrl(patch.relayUrl)) stopLocalRelay()
      config.relayUrl = patch.relayUrl
    }
    await persistConfig()
    await ensureLocalRelay()
    // 只有连接参数真的变了才重连：否则每次改一个偏好都会掉线几百毫秒，期间的互动会丢。
    if (config.enabled !== prevEnabled || config.relayUrl !== prevRelayUrl) {
      attachRelay()
    } else if (config.enabled && pairing.code !== '' && relay === null) {
      attachRelay()
    }
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
    if (!peers.has(to)) return { ok: false, reason: 'unknown-peer' }
    return sendInteraction(to, req)
  }

  function sendInteraction(to, req) {
    const intent = String(req.intent ?? '')
    if (!INTENTS.includes(intent)) return { ok: false, reason: 'invalid-intent' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    if (!canInteract('out:' + to)) return { ok: false, reason: 'rate-limited' }
    const msgId = 'i-' + randomUUID().slice(0, 8)
    const track = intent === 'music' ? sanitizeTrack(req.track) : null
    const sent = relay.send({
      v: PROTOCOL_VERSION,
      type: 'interaction',
      to,
      payload: {
        msgId,
        intent,
        note: sanitizeText(req.note, intent === 'action' ? 64 : 40),
        fromName: profile().name,
        ...(track ? { track } : {}),
      },
    })
    if (!sent) return { ok: false, reason: 'send-failed' }
    counters.interactionsOut += 1
    counters.sent += 1
    return { ok: true, msgId }
  }

  function onlinePeerIds() {
    const now = Date.now()
    return [...peers.values()]
      .filter((peer) => now - peer.lastSeen < 120_000)
      .map((peer) => peer.deviceId)
  }

  /** 多人联机：把同一种互动一次发给房间里所有在线设备。 */
  async function interactAll(req) {
    const intent = String(req.intent ?? '')
    if (!INTENTS.includes(intent)) return { ok: false, reason: 'invalid-intent' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    const targets = onlinePeerIds()
    if (targets.length === 0) return { ok: false, reason: 'no-peer' }
    let sent = 0
    let skipped = 0
    const results = []
    for (const to of targets) {
      const result = sendInteraction(to, req)
      if (result.ok) sent += 1
      else {
        skipped += 1
        results.push({ to, reason: result.reason })
      }
    }
    if (sent === 0) return { ok: false, reason: results[0]?.reason ?? 'send-failed', results }
    return { ok: true, sent, skipped, total: targets.length, results }
  }

  /** 多人联机：纯文字（或 AI 回复）一次发给房间里所有在线设备。 */
  async function chatAll(req) {
    const text = sanitizeText(req.text, CHAT_MAX_CHARS)
    if (text === '') return { ok: false, reason: 'empty-text' }
    if (!relay || relay.status !== 'online') return { ok: false, reason: 'relay-offline' }
    const raw = req.raw === true
    const targets = onlinePeerIds()
    if (targets.length === 0) return { ok: false, reason: 'no-peer' }
    let sent = 0
    let skipped = 0
    for (const to of targets) {
      if (!canRate('oc:' + to, CHAT_PER_MINUTE)) {
        skipped += 1
        continue
      }
      const msgId = 'c-' + randomUUID().slice(0, 8)
      const ok = relay.send({
        v: PROTOCOL_VERSION,
        type: 'chat',
        to,
        payload: { msgId, text, fromName: profile().name, ...(raw ? { raw: true } : {}) },
      })
      if (!ok) {
        skipped += 1
        continue
      }
      pushChat(to, { from: 'me', text, at: Date.now(), raw })
      counters.sent += 1
      sent += 1
    }
    if (sent === 0) return { ok: false, reason: skipped > 0 ? 'rate-limited' : 'send-failed' }
    return { ok: true, sent, skipped, total: targets.length }
  }

  /** 面板/右键发起的「共享当前音乐」。 */
  async function musicNow() {
    return bridge.musicNow()
  }

  /** 本机客户端探测到正在播放的动画名：写进下一帧 presence 并立刻广播。 */
  function setLocalAction(rawAnim) {
    const anim = sanitizeText(rawAnim, 32)
    if (anim === '') return { ok: false, reason: 'empty-anim' }
    const now = Date.now()
    if (now - localAction.at < 150) return { ok: true, throttled: true }
    localAction = { anim, at: now }
    publishPresence(true).catch(() => {})
    return { ok: true }
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
    interactAll,
    chat: chatTo,
    chatAll,
    musicNow,
    requestMusicPlay,
    syncMusicNow,
    setLocalAction,
    checkUpdate,
    applyUpdate: applyUpdateNow,
    get deviceId() {
      return deviceId
    },
  }
}
