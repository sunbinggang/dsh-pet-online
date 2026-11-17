/**
 * dsh-pet-online 协议层（两端共用，无 Node/浏览器依赖）。
 *
 * 设计约束：
 *  - 远端只能表达「意图」，不能传任意动画名/任意文案：动画由本机从自己的池子里挑，
 *    文案由本机模板拼装，避免远端发来本机不存在的素材名或注入文本。
 *  - 所有 peer 提供的文本一律经 sanitizeText 收窄（去控制字符 + 截断）。
 *  - 配对码 = 房间码：两端输入同一个 6 位码即进入同一 relay 房间，relay 不保存配对状态。
 */

/** 协议版本：帧里带 v，双方不一致时只提示、不中断（MVP 兼容策略）。 */
export const PROTOCOL_VERSION = 1

/** 本插件自己的 HTTP 路由前缀（webServer.register 用）。 */
export const ROUTE_SEGMENT = '/dsh-pet-online'

/** dsh-pet 的公开路由前缀（只读状态 + 动作端点）。 */
export const PET_ROUTE_SEGMENT = '/dsh-pet-7340'

/** 允许远端发起的互动意图。 */
export const INTENTS = Object.freeze([
  'wave',
  'treat',
  'pet',
  'poke',
  'hug',
  'visit-note',
  'music',
  'sleep',
  'wake',
  'action',
])

/** 每种意图在本机侧要做什么（bridge-in 按这张表翻译成 dsh-pet 路由调用）。 */
export const INTENT_SPECS = Object.freeze({
  wave: { anim: 'click', text: '{name} 跟你打招呼啦', bubble: '来自 {from} 的问候' },
  treat: { anim: 'eat', text: '{from} 给你投喂了零食～', bubble: '收到 {from} 的投喂' },
  pet: { anim: 'click', text: '被 {from} 摸了摸头', bubble: '{from} 摸了摸你' },
  poke: { anim: null, text: '{from} 戳了你一下', bubble: '{from} 戳了你一下' },
  hug: { anim: 'click', text: '{from} 抱了抱你', bubble: '抱抱！' },
  'visit-note': { anim: null, text: '{from} 留了句话：{note}', bubble: '留言' },
  music: { anim: 'click', text: '{from} 正在听：{note}', bubble: '正在听歌' },
  sleep: { anim: null, text: '{from} 哄睡了你的宠物', bubble: '{from} 哄你睡觉' },
  wake: { anim: null, text: '{from} 把你的宠物叫醒了', bubble: '{from} 叫醒你啦' },
  action: { anim: null, text: '{from} 让宠物表演了「{note}」', bubble: '来自 {from} 的动作' },
})

/** 音乐来源：local 本机曲库 / qq、kg、nc 在线曲库 / radio 网络电台。 */
export const MUSIC_SOURCES = Object.freeze(['local', 'qq', 'kg', 'nc', 'radio'])

/**
 * 收窄一条被共享的曲目信息（只用于对端「播放同一首」，不传文件内容）。
 * @returns {{id:string,name:string,artists:string[],source:string}|null}
 */
export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const name = sanitizeText(raw.name, 80)
  if (name === '') return null
  const id = typeof raw.id === 'string' ? raw.id.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 120) : ''
  const artists = Array.isArray(raw.artists)
    ? raw.artists.map((a) => sanitizeText(a, 32)).filter((a) => a !== '').slice(0, 4)
    : []
  const source = MUSIC_SOURCES.includes(raw.source) ? raw.source : 'local'
  // 电台是直播流：接收端没有可映射的曲目 id，只能带上流地址（仅 http/https）。
  const url =
    source === 'radio' && typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url.trim())
      ? raw.url.trim().slice(0, 500)
      : ''
  return { id, name, artists, source, ...(url === '' ? {} : { url }) }
}

/** 配对码字符表：去掉易混的 0/O/1/I。 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 配对码长度。 */
export const CODE_LENGTH = 6

/** 一个房间最多多少台设备（relay 与插件侧同一口径）。 */
export const MAX_ROOM_MEMBERS = 8

/** 单帧上限（字节）：presence 帧最大，留足余量。 */
export const MAX_FRAME_BYTES = 64 * 1024

/** 每对设备每分钟的互动上限。 */
export const INTERACTION_PER_MINUTE = 6

/** 跨机聊天：单条消息上限（字符）。 */
export const CHAT_MAX_CHARS = 500

/** 跨机聊天：每对设备每分钟消息上限。 */
export const CHAT_PER_MINUTE = 3

/** 生成一个 6 位配对码（大小写不敏感，统一大写）。 */
export function newPairingCode(random = Math.random) {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  }
  return out
}

/** 规范化用户输入的配对码：去空白、转大写；非法返回 ''。 */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return ''
  const code = raw.replace(/\s+/g, '').toUpperCase()
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : ''
}

/** 把配对码映射成 relay 房间名。 */
export function roomOf(code) {
  return 'pair:' + normalizeCode(code)
}

/** 设备 id 形状。 */
export function isValidDeviceId(raw) {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(raw)
}

/**
 * 收窄一段 peer 文本：去控制字符、压缩空白、截断到 max 个字符。
 * 空串返回 ''（调用方决定空串是否合法）。
 */
export function sanitizeText(raw, max = 40) {
  if (typeof raw !== 'string') return ''
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, max)
}

/** 整数字段收窄：非法用 fallback，超界 clamp。 */
export function clampInt(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/**
 * 校验一帧入站消息的基本形状：{v,type,payload}，type 为字符串。
 * @returns {boolean}
 */
export function isEnvelope(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  if (typeof raw.type !== 'string' || raw.type === '') return false
  return true
}

/** 校验一帧互动消息（类型 + 意图 + msgId）。 */
export function isInteraction(raw) {
  if (!isEnvelope(raw) || raw.type !== 'interaction') return false
  const p = raw.payload
  if (!p || typeof p !== 'object') return false
  if (typeof p.msgId !== 'string' || p.msgId === '') return false
  return INTENTS.includes(p.intent)
}

/** 一帧互动的幂等键：同 msgId 只处理一次。 */
export function interactionKey(frame) {
  return String(frame?.payload?.msgId ?? '')
}

/** 校验一帧跨机聊天消息。 */
export function isChat(raw) {
  if (!isEnvelope(raw) || raw.type !== 'chat') return false
  const p = raw.payload
  if (!p || typeof p !== 'object') return false
  if (typeof p.msgId !== 'string' || p.msgId === '') return false
  return typeof p.text === 'string' && p.text.trim() !== ''
}

/**
 * 本机宠物状态的紧凑摘要（presence 帧里发这个）。
 * 只挑联机需要的字段，绝不带对话正文以外的东西；bubble 只在 shareBubbles 时发。
 */
export function summarizePet(pet, opts = {}) {
  const shareBubbles = opts.shareBubbles !== false
  const out = {
    id: String(pet.id ?? ''),
    name: sanitizeText(pet.name, 20) || String(pet.id ?? ''),
    size: clampInt(Math.round(pet.size), 160, 32, 1024),
    display: String(pet.display ?? ''),
  }
  if (typeof pet.assetRoot === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(pet.assetRoot)) out.assetRoot = pet.assetRoot
  if (typeof pet.idle === 'string' && pet.idle !== '') out.idle = sanitizeText(pet.idle, 32)
  if (typeof pet.anim === 'string' && pet.anim !== '') out.anim = sanitizeText(pet.anim, 32)
  if (Array.isArray(pet.actions)) {
    const actions = [...new Set(pet.actions.map((name) => sanitizeText(name, 32)).filter((name) => name !== ''))].slice(0, 24)
    if (actions.length > 0) out.actions = actions
  }
  if (typeof pet.facing === 'string' && (pet.facing === 'left' || pet.facing === 'right')) out.facing = pet.facing
  if (pet.sleeping === true) out.sleeping = true
  if (typeof pet.x === 'number' && Number.isFinite(pet.x)) out.x = Math.round(pet.x * 1000) / 1000
  if (typeof pet.y === 'number' && Number.isFinite(pet.y)) out.y = Math.round(pet.y * 1000) / 1000
  if (shareBubbles && typeof pet.bubble === 'string' && pet.bubble !== '') out.bubble = sanitizeText(pet.bubble, 60)
  // 气泡配图（dsh-pet 的 say 叶子带 image 名字，投影侧按这个名字取 /pic/memes/<root>/<name>.png）
  if (shareBubbles && typeof pet.bubbleImage === 'string' && pet.bubbleImage !== '') {
    out.bubbleImage = sanitizeText(pet.bubbleImage, 40)
  }
  return out
}

/** 把「模板 + 变量」拼成一句本机气泡文案（变量已经 sanitizeText 过）。 */
export function fillTemplate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_m, key) => (key in vars ? String(vars[key]) : ''))
}
