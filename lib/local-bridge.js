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
  let lastState = null

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
      const ts = Number(value.ts) || 0
      // 电台只记当前台对象（station），没有 name 字段。
      if (key === 'dsh-music-radio-playback') {
        const station = value.station && typeof value.station === 'object' ? value.station : null
        const stationName = station && typeof station.name === 'string' ? station.name.trim() : ''
        const stationUrl = station && typeof station.url === 'string' ? station.url.trim() : ''
        if (stationName === '' || !/^https?:\/\//i.test(stationUrl)) continue
        if (best === null || ts > best.ts) {
          best = {
            id: 'radio:' + String(station.id || station.stationuuid || ''),
            name: stationName,
            artists: [],
            url: stationUrl,
            ts,
            source: 'radio',
          }
        }
        continue
      }
      const name = typeof value.name === 'string' ? value.name.trim() : ''
      if (name === '') continue
      if (best === null || ts > best.ts) {
        best = {
          id: typeof value.id === 'string' ? value.id : '',
          name,
          artists: Array.isArray(value.artists) ? value.artists.filter((a) => typeof a === 'string') : [],
          position: Number(value.position) > 0 ? Number(value.position) : 0,
          ts,
          source: key.replace(/^dsh-music-/, '').replace(/-playback$/, '') || 'local',
        }
      }
    }
    if (best === null) return { ok: false, reason: 'not-playing' }
    return {
      ok: true,
      track: {
        id: best.id,
        name: best.name,
        artists: best.artists,
        source: best.source,
        ...(best.url ? { url: best.url } : {}),
        ...(best.position > 0 ? { position: best.position } : {}),
      },
    }
  }

  /** 读一次 /state（带 since 时是长轮询；超时返回 null 让调用方下一拍再来）。 */
  async function getState(since, timeoutMs = STATE_TIMEOUT_MS) {
    const query = Number.isInteger(since) ? `?since=${since}&timeout=${timeoutMs}` : ''
    const res = await request('/state' + query, { method: 'GET' })
    if (!res.ok || !res.body || res.body.ok === false) return null
    lastState = normalizeState(res.body)
    return lastState
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

  /** 与 dsh-pet 的 animationNames() 对齐：动作端点只接受这些名字。 */
  function animationNames(animations) {
    const a = animations && typeof animations === 'object' ? animations : {}
    const out = []
    const push = (list) => {
      for (const name of Array.isArray(list) ? list : []) {
        if (typeof name === 'string' && name !== '' && !out.includes(name)) out.push(name)
      }
    }
    push(a.idle)
    push(a.turn)
    push(a.drag)
    push(a.clicks)
    const moves = a.moves && typeof a.moves === 'object' ? a.moves : {}
    push((Array.isArray(moves.actions) ? moves.actions : []).map((m) => (m && typeof m === 'object' ? m.name : undefined)))
    for (const category of Array.isArray(a.categories) ? a.categories : []) {
      if (category && typeof category === 'object') push(category.actions)
    }
    const events = a.events && typeof a.events === 'object' ? a.events : {}
    for (const key of Object.keys(events)) {
      const pool = events[key]
      if (!Array.isArray(pool)) continue
      const names = []
      for (const slot of pool) {
        if (typeof slot === 'string') names.push(slot)
        else if (Array.isArray(slot)) names.push(...slot)
      }
      push(names)
    }
    push(a.baifan)
    return out
  }

  /** 从某一套 animations 里挑出互动要用的池子（点击 / 吃东西 / 待机）。 */
  function poolsOf(animations) {
    const a = animations && typeof animations === 'object' ? animations : {}
    const strings = (value) => (Array.isArray(value) ? value.filter((n) => typeof n === 'string' && n !== '') : [])
    const idle = strings(a.idle)
    const click = strings(a.clicks)
    const eat = []
    for (const category of Array.isArray(a.categories) ? a.categories : []) {
      if (!category || typeof category !== 'object') continue
      const label = String(category.id ?? '') + String(category.name ?? '')
      if (!/吃|零食|eat|food/i.test(label)) continue
      for (const name of strings(category.actions)) if (!eat.includes(name)) eat.push(name)
    }
    return {
      click: click.length > 0 ? click : idle.length > 0 ? idle : ['点击回应-开心跃动'],
      eat,
      idle,
    }
  }

  /** 从配置里取可用的本地宠物（含动画池），给 presence 与互动翻译共用。
   *  /config 返回的是 readAllConfig 的条目树：`{ main: { pets:[], animations }, <种类>: {...} }`，
   *  不是扁平的 { pets }，所以按条目展开。 */
  async function localPets() {
    const cfg = await getConfig()
    const pets = []
    let fallbackPools = null
    for (const [entry, conf] of Object.entries(cfg ?? {})) {
      if (!conf || typeof conf !== 'object') continue
      const animations = conf.animations && typeof conf.animations === 'object' ? conf.animations : {}
      const memes = memeNames(conf.memes)
      const pools = poolsOf(animations)
      if (fallbackPools === null) fallbackPools = pools
      // 动作清单：右击菜单「动作」直接列对方本机真实存在的动画名
      const actions = animationNames(animations).slice(0, 24)
      for (const pet of Array.isArray(conf.pets) ? conf.pets : []) {
        if (!pet || typeof pet !== 'object' || typeof pet.id !== 'string' || pet.id === '') continue
        pets.push({
          id: pet.id,
          name: typeof pet.name === 'string' && pet.name !== '' ? pet.name : pet.id,
          size: clampInt(pet.size, 160, 32, 1024),
          display: String(pet.display ?? ''),
          assetRoot: entry,
          animations,
          actions,
          memes,
          pools,
          // 默认展示用的待机动画：远端还没有动作时会话里没有 anim，投影侧靠它兜底
          idle: Array.isArray(animations.idle) && typeof animations.idle[0] === 'string' ? animations.idle[0] : '',
        })
      }
    }
    return { pets, pools: fallbackPools ?? { click: ['点击回应-开心跃动'], eat: [], idle: [] } }
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

  /** 配置里的表情包（description 非空才可用，与 dsh-pet 的池判定一致）。 */
  function memeNames(memes) {
    if (!memes || typeof memes !== 'object' || Array.isArray(memes)) return []
    return Object.entries(memes)
      .filter(([name, desc]) => typeof name === 'string' && name.trim() !== '' && typeof desc === 'string' && desc.trim() !== '')
      .map(([name]) => name)
  }

  /** 每种互动想配的表情包：按顺序取本机配置里真实存在的第一张。 */
  const MEME_PREFS = {
    wave: ['Ciallo', '可爱'],
    treat: ['吃饱饱摸肚子', '吃白饭的大肥鱼', '就一碗'],
    pet: ['除了调情没啥用', '可爱'],
    poke: ['电死你'],
    hug: ['可爱'],
    'visit-note': ['哦鲸鲸'],
    music: ['鱼片有资源吗'],
    sleep: ['深度睡眠'],
    wake: ['大的要来啦'],
    action: ['厉害了我的鲸'],
  }

  function pickMeme(pet, intent) {
    const names = Array.isArray(pet?.memes) ? pet.memes : []
    for (const name of MEME_PREFS[intent] ?? []) {
      if (names.includes(name)) return name
    }
    return ''
  }

  async function broadcast(petId, text, image) {
    return request(`/broadcast?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify(image ? { text, image } : { text }),
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

  /** 让我们这只宠物睡觉 / 起床（dsh-pet 的菜单同款端点）。 */
  async function sleep(petId) {
    return request(`/sleep?pet=${encodeURIComponent(petId)}`, { method: 'POST', body: '{}' })
  }

  async function wake(petId) {
    return request(`/wake?pet=${encodeURIComponent(petId)}`, { method: 'POST', body: '{}' })
  }

  /** 让本机宠物回一句话（走它自己的 LLM 人设与记忆，跨机聊天用）。 */
  async function chat(petId, text) {
    const send = () => request(`/chat?pet=${encodeURIComponent(petId)}&surface=any`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    if (petSleeping(petId)) await wake(petId)
    let res = await send()
    let body = res.body ?? {}
    // 睡觉拦截也会命中 /chat：叫醒后重试一次
    if (body.reason === 'sleeping') {
      await wake(petId)
      res = await send()
      body = res.body ?? {}
    }
    if (!res.ok || body.ok === false) {
      return { ok: false, reason: body.reason ?? 'chat-failed', message: body.message ?? '' }
    }
    return { ok: true, text: typeof body.text === 'string' ? body.text : '', image: body.image }
  }

  /** 让本机宠物直接冒一句话（不经过模型，纯文本消息用）。 */
  async function say(text) {
    const { pets } = await localPets()
    const pet = pickPet(pets)
    if (!pet) return { ok: false, reason: 'no-pet' }
    if (petSleeping(pet.id)) await wake(pet.id)
    let res = await broadcast(pet.id, text)
    if (res.body?.reason === 'sleeping') {
      await wake(pet.id)
      res = await broadcast(pet.id, text)
    }
    if (!res.ok || res.body?.ok === false) {
      return { ok: false, reason: res.body?.reason ?? 'say-failed', petId: pet.id }
    }
    return { ok: true, petId: pet.id }
  }

  /** 这只宠物此刻是否在睡（dsh-pet 把睡觉状态写在 pets.<id>.sleep 叶子里）。 */
  function petSleeping(petId) {
    return lastState?.pets?.[petId]?.sleep?.data?.sleeping === true
  }

  /**
   * 把一条远端意图翻译成本机 dsh-pet 调用。
   * @param {string} intent
   * @param {{anim:string|null, text:string}} spec
   * @param {Record<string,string>} vars
   * @param {{bubbleOnly?:boolean}} [opts] bubbleOnly：用户正忙时只弹气泡、不抢动画
   * @returns {Promise<{ok:boolean, reason?:string, step?:string, petId?:string}>}
   */
  async function applyIntent(intent, spec, vars, opts = {}) {
    const { pets } = await localPets()
    const pet = pickPet(pets)
    if (!pet) return { ok: false, reason: 'no-pet' }
    const pools = pet.pools ?? { click: [], eat: [], idle: [] }
    const bubbleOnly = opts.bubbleOnly === true

    // 睡觉期间 dsh-pet 会拒绝 /anim、/broadcast（reason: sleeping）。
    // 哄睡本身不再广播（否则一定被拒）；其他互动先把宠物叫醒，再照常执行。
    if (intent === 'sleep') {
      if (petSleeping(pet.id)) return { ok: true, petId: pet.id, reason: 'already-sleeping' }
      const result = await sleep(pet.id)
      return result.ok && result.body?.ok !== false
        ? { ok: true, petId: pet.id }
        : { ok: false, reason: result.body?.reason ?? 'sleep-failed', step: 'sleep', petId: pet.id }
    }

    const wasSleeping = petSleeping(pet.id)
    if (wasSleeping) await wake(pet.id)
    const text = spec.text.replace(/\{(\w+)\}/g, (_m, key) => String(vars[key] ?? ''))
    // 气泡配图：从本机表情包里按意图挑一张（远端只表达意图，不指定本机素材）
    const image = pickMeme(pet, intent)

    if (intent === 'wake') {
      // 叫醒是显式要求：即使本地状态还没刷新也照发一次
      if (!wasSleeping) await wake(pet.id)
    }

    const attempt = async () => {
      const steps = []
      if (intent === 'wake') {
        steps.push({ step: 'broadcast', res: await broadcast(pet.id, text, image) })
        return steps
      }
      if (intent === 'action') {
        const name = String(vars.note ?? '').trim()
        const known = Array.isArray(pet.actions) ? pet.actions : []
        if (name === '' || (known.length > 0 && !known.includes(name))) {
          return [{ step: 'anim', res: { ok: false, status: 0, body: { ok: false, reason: 'unknown-animation' } } }]
        }
        if (!bubbleOnly) steps.push({ step: 'anim', res: await anim(pet.id, name) })
      } else if (spec.anim === 'click') {
        if (!bubbleOnly) {
          const name = pickRandom(pools.click)
          if (name !== undefined) steps.push({ step: 'anim', res: await anim(pet.id, name) })
        }
      } else if (spec.anim === 'eat') {
        if (!bubbleOnly) {
          // 优先挑名字里带「吃/零食」的动作；没有才退回点击动画。
          const eatPool = pools.eat.length > 0 ? pools.eat : pools.click
          const preferred = eatPool.filter((name) => /吃|零食|eat|food/i.test(name))
          const name = pickRandom(preferred.length > 0 ? preferred : eatPool)
          if (name !== undefined) steps.push({ step: 'anim', res: await anim(pet.id, name) })
        }
        // 注意：dsh-pet 的 /throw 是「把宠物抛出去」的物理动作，不是投喂。
        // 投喂只播吃东西的动画 + 气泡，别把对方宠物甩飞。
      }
      steps.push({ step: 'broadcast', res: await broadcast(pet.id, text, image) })
      return steps
    }

    const reasonOf = (item) => item.res.body?.reason ?? item.res.error ?? (item.res.status ? 'http-' + item.res.status : item.step + '-failed')
    let steps = await attempt()
    let failed = steps.find((item) => !item.res.ok || item.res.body?.ok === false)
    // 本地缓存的 sleep 状态可能过期（刚被哄睡/别处叫醒），遇到 sleeping 就现场叫醒再试一次
    if (failed && reasonOf(failed) === 'sleeping' && intent !== 'wake') {
      await wake(pet.id)
      steps = await attempt()
      failed = steps.find((item) => !item.res.ok || item.res.body?.ok === false)
    }
    if (failed) {
      return { ok: false, reason: reasonOf(failed), step: failed.step, petId: pet.id }
    }
    return { ok: true, petId: pet.id }
  }

  return { origin, request, musicNow, getState, getConfig, localPets, pickPet, applyIntent, broadcast, anim, throwPet, sleep, wake, chat, say }
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
