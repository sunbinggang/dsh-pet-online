/**
 * 本机 dsh-pet 的 HTTP 桥（host 半侧）。
 *
 * 只依赖 dsh-pet 的公开路由契约，不读它的配置 JSONC、不 import 它的模块：
 *  - GET  /dsh-pet-7340/state?since&timeout  长轮询全量状态
 *  - GET  /dsh-pet-7340/config               合并后的配置（宠物清单 / 动画池）
 *  - POST /dsh-pet-7340/broadcast?pet=&surface=any   气泡
 *  - POST /dsh-pet-7340/anim?pet=&surface=any        播放动画
 *  - POST /dsh-pet-7340/throw?pet=&surface=any       抛掷
 *
 * DSH 的 webServer 只监听回环地址，本插件与 dsh-pet 同进程，走 127.0.0.1 即可。
 */

import { PET_ROUTE_SEGMENT, clampInt } from './protocol.js'

const STATE_TIMEOUT_MS = 10_000
const FETCH_TIMEOUT_MS = 12_000
const CONFIG_TTL_MS = 30_000

/** 解析 DSH webServer 的 origin（端口随机，必须从 ctx 拿）。 */
export function resolveOrigin(ctx) {
  try {
    const origin = ctx.webServer?.getOrigin?.()
    if (typeof origin === 'string' && /^https?:\/\//.test(origin)) return origin
  } catch {
    /* 回落到端口拼装 */
  }
  const port = typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0
  return `http://127.0.0.1:${port}`
}

export function createLocalBridge(ctx) {
  const origin = resolveOrigin(ctx)
  let configCache = null
  let configCacheAt = 0

  async function fetchJson(url, init = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      })
      const text = await res.text()
      let body
      try {
        body = text === '' ? null : JSON.parse(text)
      } catch {
        body = null
      }
      return { status: res.status, ok: res.ok, body }
    } catch (error) {
      return { status: 0, ok: false, body: null, error: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
    }
  }

  function request(path, init = {}) {
    return fetchJson(origin + PET_ROUTE_SEGMENT + path, init)
  }

  /** 读 dsh-music-player 的播放偏好，取最近一次播放的曲目（歌名 + 歌手）。 */
  async function musicNow() {
    const res = await fetchJson(origin + '/dsh-music/prefs', { method: 'GET' })
    if (!res.ok || !res.body || res.body.ok === false) return { ok: false, reason: 'music-unavailable' }
    const prefs = res.body.prefs && typeof res.body.prefs === 'object' ? res.body.prefs : {}
    const keys = [
      'dsh-music-playback',
      'dsh-music-qq-playback',
      'dsh-music-kg-playback',
      'dsh-music-nc-playback',
      'dsh-music-radio-playback',
    ]
    let best = null
    for (const key of keys) {
      let value = prefs[key]
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          continue
        }
      }
      if (!value || typeof value !== 'object') continue
      const name = typeof value.name === 'string' ? value.name.trim() : ''
      if (name === '') continue
      const ts = Number(value.ts) || 0
      if (best === null || ts > best.ts) {
        best = {
          name,
          artists: Array.isArray(value.artists) ? value.artists.filter((a) => typeof a === 'string') : [],
          ts,
          source: key.replace(/^dsh-music-/, '').replace(/-playback$/, '') || 'local',
        }
      }
    }
    if (best === null) return { ok: false, reason: 'not-playing' }
    return { ok: true, track: { name: best.name, artists: best.artists, source: best.source } }
  }

  /** 读一次 /state（带 since 时是长轮询；超时返回 null 让调用方下一拍再来）。 */
  async function getState(since, timeoutMs = STATE_TIMEOUT_MS) {
    const query = Number.isInteger(since) ? `?since=${since}&timeout=${timeoutMs}` : ''
    const res = await request('/state' + query, { method: 'GET' })
    if (!res.ok || !res.body || res.body.ok === false) return null
    return normalizeState(res.body)
  }

  /** 读合并后的配置（缓存 30s：宠物清单与动画池变更不频繁）。 */
  async function getConfig(force = false) {
    const now = Date.now()
    if (!force && configCache !== null && now - configCacheAt < CONFIG_TTL_MS) return configCache
    const res = await request('/config', { method: 'GET' })
    if (!res.ok || !res.body || res.body.ok === false) return configCache
    configCache = res.body
    configCacheAt = now
    return configCache
  }

  /** 从配置里取可用的本地宠物（含动画池），给 presence 与互动翻译共用。
   *  /config 返回的是 readAllConfig 的条目树：`{ main: { pets:[], animations }, <种类>: {...} }`，
   *  不是扁平的 { pets }，所以按条目展开。 */
  async function localPets() {
    const cfg = await getConfig()
    const pets = []
    let mainAnimations = {}
    for (const [entry, conf] of Object.entries(cfg ?? {})) {
      if (!conf || typeof conf !== 'object') continue
      const animations = conf.animations && typeof conf.animations === 'object' ? conf.animations : {}
      if (entry === 'main') mainAnimations = animations
      for (const pet of Array.isArray(conf.pets) ? conf.pets : []) {
        if (!pet || typeof pet !== 'object' || typeof pet.id !== 'string' || pet.id === '') continue
        pets.push({
          id: pet.id,
          name: typeof pet.name === 'string' && pet.name !== '' ? pet.name : pet.id,
          size: clampInt(pet.size, 160, 32, 1024),
          display: String(pet.display ?? ''),
          assetRoot: entry,
          animations,
          // 默认展示用的待机动画：远端还没有动作时会话里没有 anim，投影侧靠它兜底
          idle: Array.isArray(animations.idle) && typeof animations.idle[0] === 'string' ? animations.idle[0] : '',
        })
      }
    }
    const clicks = Array.isArray(mainAnimations.clicks)
      ? mainAnimations.clicks.filter((n) => typeof n === 'string' && n !== '')
      : []
    const eat = []
    for (const category of Array.isArray(mainAnimations.categories) ? mainAnimations.categories : []) {
      if (!category || typeof category !== 'object') continue
      if (!/吃/.test(String(category.id ?? ''))) continue
      for (const name of Array.isArray(category.actions) ? category.actions : []) {
        if (typeof name === 'string' && name !== '') eat.push(name)
      }
    }
    const idle = Array.isArray(mainAnimations.idle)
      ? mainAnimations.idle.filter((n) => typeof n === 'string' && n !== '')
      : []
    return {
      pets,
      pools: {
        click: clicks.length > 0 ? clicks : ['点击回应-开心跃动'],
        eat,
        idle,
      },
    }
  }

  /** 选一只可交互的宠物：优先 display 含 web/desktop 的第一只。 */
  function pickPet(pets) {
    const visible = pets.filter((p) => p.display === 'web' || p.display === 'desktop' || p.display === 'both')
    return (visible.length > 0 ? visible : pets)[0] ?? null
  }

  function pickRandom(list) {
    if (!Array.isArray(list) || list.length === 0) return undefined
    return list[Math.floor(Math.random() * list.length)]
  }

  async function broadcast(petId, text) {
    return request(`/broadcast?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  }

  async function anim(petId, name) {
    return request(`/anim?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  }

  async function throwPet(petId, angle, power) {
    return request(`/throw?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify({ angle, power }),
    })
  }

  /** 让本机宠物回一句话（走它自己的 LLM 人设与记忆，跨机聊天用）。 */
  async function chat(petId, text) {
    const res = await request(`/chat?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    const body = res.body ?? {}
    if (!res.ok || body.ok === false) {
      return { ok: false, reason: body.reason ?? 'chat-failed', message: body.message ?? '' }
    }
    return { ok: true, text: typeof body.text === 'string' ? body.text : '', image: body.image }
  }

  /**
   * 把一条远端意图翻译成本机 dsh-pet 调用。
   * @param {string} intent
   * @param {{anim:string|null, text:string}} spec
   * @param {Record<string,string>} vars
   * @param {{bubbleOnly?:boolean}} [opts] bubbleOnly：用户正忙时只弹气泡、不抢动画
   * @returns {Promise<{ok:boolean, reason?:string, petId?:string}>}
   */
  async function applyIntent(intent, spec, vars, opts = {}) {
    const { pets, pools } = await localPets()
    const pet = pickPet(pets)
    if (!pet) return { ok: false, reason: 'no-pet' }
    const bubbleOnly = opts.bubbleOnly === true
    const results = []
    if (!bubbleOnly && spec.anim === 'click') {
      const name = pickRandom(pools.click)
      if (name !== undefined) results.push(await anim(pet.id, name))
    } else if (!bubbleOnly && spec.anim === 'eat') {
      const name = pickRandom(pools.eat.length > 0 ? pools.eat : pools.click)
      if (name !== undefined) results.push(await anim(pet.id, name))
      const angle = -35 + Math.random() * 70
      results.push(await throwPet(pet.id, Math.round(angle), 520 + Math.round(Math.random() * 260)))
    }
    const text = spec.text.replace(/\{(\w+)\}/g, (_m, key) => String(vars[key] ?? ''))
    results.push(await broadcast(pet.id, text))
    const first = results[0]
    const ok = results.every((r) => r.ok && r.body?.ok !== false)
    return ok
      ? { ok: true, petId: pet.id }
      : { ok: false, reason: first?.body?.reason ?? 'pet-call-failed', petId: pet.id }
  }

  return { origin, request, musicNow, getState, getConfig, localPets, pickPet, applyIntent, broadcast, anim, throwPet, chat }
}

/** 把 /state 收窄成插件内部形状（叶子只留 counter+data）。 */
export function normalizeState(raw) {
  const sections = {}
  for (const [name, leaf] of Object.entries(raw.sections ?? {})) {
    if (leaf && typeof leaf === 'object' && typeof leaf.counter === 'number') {
      sections[name] = { counter: leaf.counter, data: leaf.data ?? null }
    }
  }
  const pets = {}
  for (const [petId, leaves] of Object.entries(raw.pets ?? {})) {
    if (!leaves || typeof leaves !== 'object') continue
    const out = {}
    for (const [name, leaf] of Object.entries(leaves)) {
      if (leaf && typeof leaf === 'object' && typeof leaf.counter === 'number') {
        out[name] = { counter: leaf.counter, data: leaf.data ?? null }
      }
    }
    pets[petId] = out
  }
  return {
    counter: typeof raw.counter === 'number' ? raw.counter : 0,
    sections,
    pets,
  }
}
