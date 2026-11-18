/**
 * dsh-pet-online 浏览器半侧：设置页「桌宠联机」面板。
 *
 * 只做三件事：显示连接/在线状态、生成或输入配对码、对在线设备发起互动。
 * 深度状态同步（远端宠物在本机投影）留给 M2；这一版先让「配对 + 互相打招呼」跑通。
 */

window.__ModuleLoader__.load({
  id: 'dsh-pet-online',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState } = React

    const BASE = '/dsh-pet-online'

    const CSS = [
      '.dpo-wrap{display:flex;flex-direction:column;gap:14px;font-size:13px}',
      '.dpo-card{border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.25));border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,rgba(15,23,42,.35));color:var(--dsw-alias-label-primary,#e2e8f0)}',
      '.dpo-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dpo-title{font-weight:600;font-size:14px;margin-bottom:6px}',
      '.dpo-muted{color:var(--dsw-alias-label-secondary,#94a3b8);font-size:12px}',
      '.dpo-btn{border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}',
      '.dpo-btn.primary{background:var(--dsw-alias-brand-primary,#2f6df6);color:#fff;border-color:transparent}',
      '.dpo-btn.primary:hover,.dpo-btn.primary:visited{color:#fff}',
      'a.dpo-btn{text-decoration:none}',
      '.dpo-btn[disabled]{opacity:.55;cursor:not-allowed}',
      '.dpo-input{border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));background:var(--dsw-alias-bg-base,transparent);color:inherit;border-radius:8px;padding:4px 8px;font-size:12px;width:140px;letter-spacing:2px;text-transform:uppercase}',
      '.dpo-code{font-family:ui-monospace,Consolas,monospace;font-size:20px;letter-spacing:6px;font-weight:700}',
      '.dpo-peer{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.22))}',
      '.dpo-peer-main{flex:1 1 auto;min-width:0}',
      '.dpo-peer-name{font-weight:600}',
      '.dpo-peer-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#94a3b8)}',
      '.dpo-ok{color:var(--dsw-alias-state-success-primary,#22c55e)}',
      '.dpo-err{color:var(--dsw-alias-state-error-primary,#ef4444)}',
      '.dpo-toast{position:fixed;right:16px;bottom:16px;z-index:4000;display:flex;flex-direction:column;gap:8px}',
      '.dpo-toast-item{background:var(--dsw-alias-bg-base,#111827);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.3));border-radius:10px;padding:8px 12px;font-size:12px}',
      '.dpo-guest-layer{position:fixed;inset:0;pointer-events:none;z-index:15;overflow:hidden}',
      '.dpo-guest-layer.dpo-menu-open{z-index:2147483000}',
      '.dpo-menu-sep{height:1px;margin:4px 8px;background:var(--dsw-alias-border-l1,rgba(148,163,184,.28))}',
      '.dpo-menu-sub{max-height:260px;overflow:auto}',
      '.dpo-share-music{position:fixed;right:16px;bottom:16px;z-index:2147483001;max-width:300px;padding:8px 26px 8px 10px;border-radius:10px;background:var(--dsw-alias-bg-base,#111827);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));box-shadow:0 8px 24px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary,#e2e8f0);font-size:12px;pointer-events:auto}',
      '.dpo-share-music-title{font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dpo-share-music-close{position:absolute;top:2px;right:4px;width:18px;height:18px;padding:0;border:0;background:transparent;color:inherit;font-size:14px;line-height:18px;cursor:pointer;opacity:.6}',
      '.dpo-share-music-close:hover{opacity:1}',
      '.dpo-chat-input{flex:1 1 160px;min-width:120px;border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));background:var(--dsw-alias-bg-base,transparent);color:inherit;border-radius:8px;padding:4px 8px;font-size:12px}',
      '.dpo-guest{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;will-change:transform;touch-action:none}',
      '.dpo-guest video{display:block;pointer-events:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.18))}',
      // 气泡固定用白底深字：不能再取 --dsw-alias-bg-base（深色主题下它就是页面底色，气泡会整块“隐形”只剩文字）。
      '.dpo-guest-bubble{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);z-index:3;margin-bottom:8px;max-width:240px;padding:6px 11px;border-radius:11px;background:#fff;border:1px solid rgba(148,163,184,.45);color:#1f2937;font-size:12px;line-height:1.4;text-align:center;white-space:pre-wrap;word-break:break-word;box-shadow:0 6px 18px rgba(0,0,0,.22);pointer-events:none}',
      ".dpo-guest-bubble::after{content:'';position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);border:6px solid transparent;border-top-color:#fff;border-bottom:0}",
      '.dpo-guest-bubble.has-img{width:auto;min-width:96px;padding:6px 8px 7px}',
      '.dpo-guest-bubble-img{display:block;width:104px;max-width:100%;height:auto;border-radius:8px;margin:0 auto 5px;object-fit:cover}',
      '.dpo-guest-name{margin-top:4px;padding:1px 8px;border-radius:9px;background:rgba(15,23,42,.45);color:#e2e8f0;font-size:11px;white-space:nowrap}',
      '.dpo-guest.dpo-sleeping{opacity:.55}',
      '.dpo-guest-zzz{font-size:12px;color:#94a3b8}',
      '.dpo-chat-line{padding:3px 0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary,#e2e8f0)}',
      '.dpo-chat-time{display:inline-block;min-width:34px;margin-right:6px;color:var(--dsw-alias-label-tertiary,#94a3b8);font-variant-numeric:tabular-nums;font-size:11px}',
      '.dpo-menu-backdrop{position:fixed;inset:0;z-index:30;pointer-events:auto}',
      '.dpo-menu{position:fixed;z-index:31;min-width:150px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-base,#111827);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:auto}',
      '.dpo-menu-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e2e8f0);font-size:12px;padding:6px 10px;border-radius:6px;cursor:pointer;pointer-events:auto}',
      '.dpo-menu-item:hover{background:var(--dsw-alias-bg-layer-1,rgba(148,163,184,.18))}',
      '.dpo-menu-item[disabled]{opacity:.45;cursor:not-allowed}',
      '.dpo-menu-title{padding:4px 10px 6px;font-size:11px;color:var(--dsw-alias-label-secondary,#94a3b8)}',
      '.dpo-compose{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483002;width:min(360px,calc(100vw - 32px));padding:14px;border-radius:12px;background:var(--dsw-alias-bg-base,#111827);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));box-shadow:0 20px 50px rgba(0,0,0,.45);pointer-events:auto;color:var(--dsw-alias-label-primary,#e2e8f0);box-sizing:border-box}',
      '.dpo-compose-title{font-size:13px;margin-bottom:8px;line-height:1.4}',
      '.dpo-compose-input{width:100%;min-height:64px;resize:vertical;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.4));background:var(--dsw-alias-bg-layer-1,rgba(15,23,42,.6));color:var(--dsw-alias-label-primary,#e2e8f0);font:inherit;font-size:12px;padding:8px;box-sizing:border-box}',
      '.dpo-compose-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}',
      '.dpo-compose-hint{margin-top:6px;font-size:11px;color:var(--dsw-alias-label-secondary,#94a3b8)}',
      '.dpo-overlay-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:32;padding:8px 14px;border-radius:10px;background:var(--dsw-alias-bg-base,#111827);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));font-size:12px;color:var(--dsw-alias-label-primary,#e2e8f0);pointer-events:none}',
    ].join('\n')

    function installStyles() {
      const tag = document.createElement('style')
      tag.setAttribute('data-plugin', 'dsh-pet-online')
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => tag.parentNode && tag.parentNode.removeChild(tag)
    }

    async function getJson(path, init) {
      const res = await fetch(BASE + path, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      return res.json().catch(() => ({ ok: false, reason: 'bad-response' }))
    }

    // ---- 跨机「播放同一首」：在本机找同名曲目，找不到再按在线源 id 走代理流 ----
    const canon = (value) =>
      String(value ?? '')
        .toLowerCase()
        .replace(/\.[a-z0-9]{2,4}$/, '')
        .replace(/[\s_\-()[\]（）【】·]/g, '')

    let sharedAudio = null
    let lastDirectMusicAt = 0
    let pendingMusic = null
    let musicUnlockArmed = false
    let sharedState = { seq: 0, playing: false, title: '', fromName: '', error: '', blocked: false, track: null, hidden: false }
    const sharedListeners = new Set()
    function sharedSet(patch) {
      sharedState = { ...sharedState, ...patch }
      for (const listener of [...sharedListeners]) listener(sharedState)
    }
    function useSharedMusic() {
      const [state, setState] = useState(sharedState)
      useEffect(() => {
        sharedListeners.add(setState)
        setState(sharedState)
        return () => sharedListeners.delete(setState)
      }, [])
      return state
    }
    function stopSharedMusic() {
      pendingMusic = null
      if (sharedAudio) {
        try {
          sharedAudio.pause()
          sharedAudio.removeAttribute('src')
          sharedAudio.load()
        } catch {
          /* ignore */
        }
      }
      sharedSet({ playing: false, blocked: false })
    }

    /** 在用户点击/勾选这类手势里放一段静音，解锁本页的 HTMLAudio 自动播放权限。 */
    function unlockSharedAudio() {
      try {
        // 已经在放歌时不要拿静音 WAV 去覆盖同一个元素，否则会「状态在播放、声音没了」。
        if (sharedAudio !== null && !sharedAudio.paused) return
        if (sharedAudio === null) sharedAudio = new Audio()
        sharedAudio.volume = 0
        sharedAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
        const played = sharedAudio.play()
        if (played && typeof played.then === 'function') {
          played
            .then(() => {
              try {
                sharedAudio.pause()
                sharedAudio.removeAttribute('src')
                sharedAudio.load()
                sharedAudio.volume = 1
              } catch {
                /* ignore */
              }
            })
            .catch(() => {
              // 静音 WAV 没播成功也要恢复音量，否则后续「正在播放」会静音。
              try {
                sharedAudio.volume = 1
              } catch {
                /* ignore */
              }
            })
        }
      } catch {
        try {
          sharedAudio.volume = 1
        } catch {
          /* ignore */
        }
      }
    }

    /** 被自动播放策略拦下时，等用户下一次点页面（真实手势）再重试同一首。 */
    function armMusicUnlockRetry() {
      if (musicUnlockArmed) return
      musicUnlockArmed = true
      const retry = () => {
        document.removeEventListener('pointerdown', retry, true)
        musicUnlockArmed = false
        const pending = pendingMusic
        pendingMusic = null
        if (!pending) return
        if (pending.mode === 'player') void syncViaMusicPlayer(pending.track, pending.fromName)
        else void playSharedTrack(pending.track, pending.fromName)
      }
      document.addEventListener('pointerdown', retry, true)
    }

    /** 停止共享播放：内置播放器直接停；如果声音在音乐播放器里，给它下发一条 stop 意图。 */
    function stopSharedPlayback() {
      if (sharedState.track && sharedState.playing) musicIntentOverride = { action: 'stop' }
      stopSharedMusic()
      sharedSet({ hidden: true })
    }

    // ---- 本机「正在播放什么」：直读 dsh-music-player 的 prefs，不依赖宿主快照 ----
    // 播放器写 prefs 有 800ms 防抖，宿主 GET /dsh-music/prefs 有时还是旧快照，
    // 表现为「播放器明明在放，却说没有正在播放音乐」。这里在页面内截获播放器自己
    // 的 prefs 写入（POST body 就是最新值），共享时优先用这份内存快照。
    let musicPrefsCache = {}

    function mergeMusicPrefs(patch, remove) {
      if (patch && typeof patch === 'object') {
        for (const key of Object.keys(patch)) musicPrefsCache[key] = patch[key]
      }
      if (Array.isArray(remove)) for (const key of remove) delete musicPrefsCache[key]
    }

    function readTrackFromPrefs(prefs) {
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
              source: 'radio',
              url: stationUrl,
              ts,
            }
          }
          continue
        }
        const name = typeof value.name === 'string' ? value.name.trim() : ''
        if (name === '') continue
        if (best === null || ts > best.ts) {
          const pos = Number(value.position)
          best = {
            id: typeof value.id === 'string' ? value.id : '',
            name,
            artists: Array.isArray(value.artists) ? value.artists.filter((a) => typeof a === 'string') : [],
            source: key.replace(/^dsh-music-/, '').replace(/-playback$/, '') || 'local',
            position: Number.isFinite(pos) && pos > 0 ? pos : 0,
            ts,
          }
        }
      }
      if (best === null) return null
      const track = { id: best.id, name: best.name, artists: best.artists, source: best.source }
      if (best.url) track.url = best.url
      if (best.position > 0) track.position = best.position
      return track
    }

    // ---- 本机自动切歌：由页面先发现（播放器 prefs 一写就知道），再让宿主广播 ----
    // 宿主每 2.5 秒读一次 prefs 也能发现，但它读的是防抖后的快照，且电台/讲书等
    // 场景可能读不到；页面这份快照更及时，自动连播下一首也能立刻同步给房间。
    let lastAutoSyncKey = ''
    let lastAutoSentPos = -1
    let autoSyncPrimed = false
    let lastRemoteApplyKey = ''
    let lastRemoteApplyAt = 0
    let lastRemoteSyncAt = 0
    let lastAlignAt = 0
    let autoSyncTimer = null
    let pendingAutoSyncTrack = null

    function trackKeyOf(track) {
      if (!track || typeof track !== 'object') return ''
      const source = String(track.source || 'local')
      const id = typeof track.id === 'string' ? track.id : ''
      if (id !== '') return source + ':' + id
      const artists = Array.isArray(track.artists) ? track.artists.join(',') : ''
      return source + ':name:' + canon(track.name) + '|' + canon(artists)
    }

    /** 播放器自己换了歌（含自动连播）：节流后把新曲目推给房间。 */
    function scheduleAutoMusicSync(track) {
      if (!track || typeof track.name !== 'string' || track.name === '') return
      const key = trackKeyOf(track)
      if (key === '') return
      // 正在跟随对端这首（进度心跳持续到达）时，本机播放器自己的进度写回不要再反弹回房间。
      if (key === lastRemoteApplyKey && Date.now() - lastRemoteSyncAt < 15_000) return
      if (!autoSyncPrimed) {
        // 页面刚打开时先对齐当前曲目，不立刻广播（避免一刷新就把房间拽到自己这首）。
        autoSyncPrimed = true
        lastAutoSyncKey = key
        lastAutoSentPos = Number(track.position) || 0
        return
      }
      const pos = Number(track.position) || 0
      if (key === lastAutoSyncKey) {
        // 同一首的进度心跳：位置没动（暂停/暂停久了）就不打扰房间。
        if (pos === lastAutoSentPos) return
      } else {
        lastAutoSyncKey = key
      }
      lastAutoSentPos = pos
      pendingAutoSyncTrack = track
      if (autoSyncTimer !== null) return
      autoSyncTimer = setTimeout(() => {
        autoSyncTimer = null
        const pending = pendingAutoSyncTrack
        pendingAutoSyncTrack = null
        if (!pending) return
        void fetch(BASE + '/music/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ track: pending, auto: true }),
        }).catch(() => {})
      }, 800)
    }

    /** 共享前读一次「当前播放」：内存快照 → 直读宿主 prefs（带短暂重试）。 */
    async function currentMusicTrack() {
      const cached = readTrackFromPrefs(musicPrefsCache)
      if (cached) return cached
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const res = await fetch('/dsh-music/prefs', { cache: 'no-store' })
          if (res.ok) {
            const data = await res.json()
            if (data && data.prefs && typeof data.prefs === 'object') {
              mergeMusicPrefs(data.prefs)
              const track = readTrackFromPrefs(data.prefs)
              if (track) return track
            }
          }
        } catch {
          /* 音乐插件没装：下面统一返回 null */
        }
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 300))
      }
      return null
    }

    async function resolveSharedSource(track) {
      const source = String(track.source ?? 'local')
      // 电台：对端只可能带流地址过来，直接播这个地址。
      if (source === 'radio' && typeof track.url === 'string' && /^https?:\/\//i.test(track.url)) return track.url
      try {
        const res = await fetch('/dsh-music/manifest', { cache: 'no-store' })
        if (res.ok) {
          const manifest = await res.json()
          const name = canon(track.name)
          const artists = (Array.isArray(track.artists) ? track.artists : []).map(canon).filter(Boolean)
          const hit = (Array.isArray(manifest.tracks) ? manifest.tracks : []).find((item) => {
            if (canon(item.name) !== name) return false
            if (artists.length === 0) return true
            const path = canon(item.path)
            return artists.every((artist) => path.includes(artist))
          })
          if (hit && typeof hit.id === 'string' && hit.id !== '') return '/dsh-music/' + encodeURIComponent(hit.id)
        }
      } catch {
        /* 音乐插件没装或没开：继续尝试在线源 */
      }
      const rawId = String(track.id ?? '')
      const key = rawId.startsWith(source + ':') ? rawId.slice(source.length + 1) : rawId
      if (key === '') return ''
      if (source === 'nc' && /^\d+$/.test(key)) return '/dsh-music/nc/play/' + key
      if (source === 'qq') return '/dsh-music/qq/play/' + encodeURIComponent(key)
      if (source === 'kg' && /^[0-9a-f]{8,64}$/i.test(key)) return '/dsh-music/kg/play/' + encodeURIComponent(key)
      return ''
    }

    async function playSharedTrack(track, fromName) {
      if (!track || typeof track.name !== 'string' || track.name === '') return
      stopSharedMusic()
      const src = await resolveSharedSource(track)
      const title = track.name + (track.artists && track.artists.length > 0 ? ' - ' + track.artists.join('/') : '')
      if (src === '') {
        sharedSet({ playing: false, blocked: false, title, fromName, error: '本机曲库和在线源都没有这首歌' })
        return
      }
      sharedSet({ playing: true, blocked: false, title, fromName, error: '', seq: Date.now(), track, hidden: false })
      try {
          if (sharedAudio === null) {
          sharedAudio = new Audio()
          sharedAudio.preload = 'auto'
          sharedAudio.addEventListener('ended', () => sharedSet({ playing: false }))
          sharedAudio.addEventListener('error', () => sharedSet({ playing: false, error: '播放失败（可能是登录态或版权受限）' }))
        }
        // unlockSharedAudio 会临时把音量降到 0 播静音 WAV；任何一次没恢复都会让后面「正在播放」却没声音。
        sharedAudio.volume = 1
        sharedAudio.muted = false
        sharedAudio.src = src
        const pos = Number(track.position) || 0
        if (pos > 0) {
          const seek = () => {
            try {
              sharedAudio.currentTime = pos
            } catch {
              /* ignore */
            }
          }
          if (sharedAudio.readyState >= 1) seek()
          else sharedAudio.addEventListener('loadedmetadata', seek, { once: true })
        }
        await sharedAudio.play()
        sharedSet({ playing: true, blocked: false })
      } catch (error) {
        pendingMusic = { track, fromName }
        armMusicUnlockRetry()
        sharedSet({ playing: false, blocked: true, error: '浏览器拦截了自动播放，点页面任意位置继续' })
      }
    }

    /** 面板按钮里直接播放：保留用户手势，避免「点按钮只发请求、真正播放时被浏览器拦截」。 */
    function playSharedFromGesture(track, fromName) {
      lastDirectMusicAt = Date.now()
      return playSharedTrack(track, fromName)
    }

    // ---- 跟随房间切歌：让 dsh-music-player 自己播（而不是插件内再挂一个 <audio>） ----
    // dsh-music-player 的宿主没有 /intent 的写接口，浏览器半侧每 2s 轮询 GET /dsh-music/intent。
    // 我们在页面里旁路这条请求：轮询到来时把对端的曲目当作「播放意图」回给它，
    // 于是走它自己的取链、队列、播放条与进度保存，播放的是同一个播放器。
    let musicIntentOverride = null
    let musicIntentFallback = null

    async function resolveMusicIntent(track) {
      const source = String(track.source ?? 'local')
      if (source === 'radio' && typeof track.url === 'string' && /^https?:\/\//i.test(track.url)) {
        return {
          action: 'play',
          kind: 'radio',
          id: String(track.id ?? ''),
          name: track.name,
          radioUrl: track.url,
        }
      }
      const rawId = String(track.id ?? '')
      const key = rawId.startsWith(source + ':') ? rawId.slice(source.length + 1) : rawId
      if (source === 'nc' && /^\d+$/.test(key)) {
        return { action: 'play', kind: 'nc', id: key, name: track.name, artists: track.artists || [] }
      }
      if (source === 'qq' && /^[A-Za-z0-9]+$/.test(key)) {
        return { action: 'play', kind: 'qq', id: key, name: track.name, artists: track.artists || [] }
      }
      if (source !== 'local') return null
      // 本地曲目的 id 因机器而异：接收端按歌名在 manifest 里找自己那份。
      try {
        const res = await fetch('/dsh-music/manifest', { cache: 'no-store' })
        if (!res.ok) return null
        const manifest = await res.json()
        const name = canon(track.name)
        const artists = (Array.isArray(track.artists) ? track.artists : []).map(canon).filter(Boolean)
        const hit = (Array.isArray(manifest.tracks) ? manifest.tracks : []).find((item) => {
          if (canon(item.name) !== name) return false
          if (artists.length === 0) return true
          const path = canon(item.path)
          return artists.every((artist) => path.includes(artist))
        })
        if (hit && typeof hit.id === 'string' && hit.id !== '') return { action: 'play', id: hit.id, name: track.name }
      } catch {
        /* 没有音乐插件 */
      }
      return null
    }

    /** 找 dsh-music-player 正在用的 <audio>：按意图 id 匹配源码，退而取正在播放的那个。 */
    function findPlayerAudio(intent) {
      if (!intent) return null
      const wanted = String(intent.id || '')
      const nodes = Array.from(document.querySelectorAll('audio'))
      for (const node of nodes) {
        if (node === sharedAudio) continue
        const src = String(node.currentSrc || node.src || '')
        if (src === '') continue
        if (wanted !== '' && src.includes(wanted)) return node
      }
      for (const node of nodes) {
        if (node === sharedAudio) continue
        if (!node.paused) return node
      }
      return null
    }

    /** 对端从 1:30 切过来时，让本机播放器也落到 1:30，而不是从头放。 */
    function seekPlayerTo(intent, position) {
      if (!(position > 0)) return
      let tries = 0
      const attempt = () => {
        const node = findPlayerAudio(intent)
        if (!node) {
          tries += 1
          if (tries < 40) setTimeout(attempt, 400)
          return
        }
        const apply = () => {
          try {
            if (!(node.currentTime > 0) || Math.abs(node.currentTime - position) > 1.5) {
              node.currentTime = position
            }
          } catch {
            /* 还没可 seek，稍后再试 */
          }
        }
        if (node.readyState >= 1) apply()
        else node.addEventListener('loadedmetadata', apply, { once: true })
        // 播放器有时先按旧进度起播、加载完再覆盖，这里补一次校准。
        setTimeout(() => {
          try {
            if (node.readyState >= 1 && node.currentTime < 1 && position > 3) node.currentTime = position
          } catch {
            /* ignore */
          }
        }, 3000)
      }
      setTimeout(attempt, 400)
    }

    /** 同一首的进度心跳：把本机播放器校准到对端位置（不重新起播）。 */
    async function alignRemotePosition(track) {
      if (Date.now() - lastAlignAt < 2_500) return
      lastAlignAt = Date.now()
      const intent = await resolveMusicIntent(track)
      if (intent === null) return
      seekPlayerTo(intent, Number(track.position) || 0)
    }

    /** 把对端曲目交给 dsh-music-player；没有可用的播放器时退回插件内播放。 */
    async function syncViaMusicPlayer(track, fromName) {
      const intent = await resolveMusicIntent(track)
      if (intent === null) {
        void playSharedTrack(track, fromName)
        return
      }
      musicIntentOverride = intent
      stopSharedMusic()
      // 这是我们按对端意图切过去的歌：本页的自动切歌检测不要把它再当成本机新切歌广播回去。
      lastRemoteApplyKey = trackKeyOf(track)
      lastAutoSyncKey = trackKeyOf(track)
      lastAutoSentPos = Number(track.position) || 0
      autoSyncPrimed = true
      lastRemoteApplyAt = Date.now()
      seekPlayerTo(intent, Number(track.position) || 0)
      const artists = Array.isArray(track.artists) && track.artists.length > 0 ? ' - ' + track.artists.join('/') : ''
      // 同步播放统一交给 dsh 音乐播放器：插件自己不弹右下角播放条，避免出现「两个播放器」。
      sharedSet({ title: track.name + artists, fromName, playing: false, blocked: false, error: '正在音乐播放器里切换…', track, hidden: true })
      // 播放器取到意图后一般 1~2 秒内起播，及时把状态从「切换中」改成「播放中」。
      setTimeout(() => {
        const node = findPlayerAudio(intent)
        if (node && !node.paused && !node.ended) {
          if (node.muted || node.volume === 0) {
            sharedSet({ playing: true, blocked: false, error: '音乐播放器在播放，但当前是静音/音量为 0', hidden: false })
          } else {
            sharedSet({ playing: true, blocked: false, error: '正在音乐播放器里播放', hidden: true })
          }
        }
      }, 1800)
      if (musicIntentFallback !== null) clearTimeout(musicIntentFallback)
      // 5 秒还没起播：挂成「下一次点击重试」，不再偷偷用内置播放器出声——否则用户会觉得
      // 声音不知道从哪来、播放器里又没有这首歌。
      musicIntentFallback = setTimeout(() => {
        musicIntentFallback = null
        if (musicIntentOverride === intent) {
          // 意图一直没人取：音乐插件没开，退内置播放器。
          musicIntentOverride = null
          playSharedTrack(track, fromName).catch(() => {})
          return
        }
        const node = findPlayerAudio(intent)
        if (node && !node.paused && !node.ended) {
          if (node.muted || node.volume === 0) {
            sharedSet({ playing: true, blocked: false, error: '音乐播放器在播放，但当前是静音/音量为 0', hidden: false })
          } else {
            sharedSet({ playing: true, blocked: false, error: '正在音乐播放器里播放', hidden: true })
          }
          return
        }
        pendingMusic = { track, fromName, mode: 'player' }
        armMusicUnlockRetry()
        sharedSet({ playing: false, blocked: true, error: '音乐播放器被浏览器拦截了，点页面任意位置重试', hidden: false })
      }, 5000)
    }

    function useSnapshot() {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState(null)
      useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const data = await getJson('/state')
            if (alive) {
              setSnap(data)
              setError(null)
            }
          } catch (e) {
            if (alive) setError(String(e && e.message ? e.message : e))
          }
        }
        tick()
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') tick()
        }, 2000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])
      return { snap, error }
    }

    // 聊天记录时间：今天只显示 HH:MM，跨天补 M/D，避免长会话里看不出先后。
    function formatChatTime(at) {
      const t = Number(at)
      if (!Number.isFinite(t) || t <= 0) return ''
      const d = new Date(t)
      const pad = (n) => String(n).padStart(2, '0')
      const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      return sameDay ? hm : d.getMonth() + 1 + '/' + d.getDate() + ' ' + hm
    }

    function Panel() {
      const { snap, error } = useSnapshot()
      const shared = useSharedMusic()
      const [code, setCode] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [toasts, setToasts] = useState([])
      const [accept, setAccept] = useState(true)
      const [share, setShare] = useState(true)
      const [acceptChat, setAcceptChat] = useState(true)
      const [acceptRawChat, setAcceptRawChat] = useState(true)
      const [acceptRemoteMusic, setAcceptRemoteMusic] = useState(false)
      const [syncMusic, setSyncMusic] = useState(true)
      const [drafts, setDrafts] = useState({})
      const [compose, setCompose] = useState(null)
      const [updateCheckOn, setUpdateCheckOn] = useState(true)
      const [relayUrlInput, setRelayUrlInput] = useState('')

      useEffect(() => {
        if (snap && snap.config && typeof snap.config.relayUrl === 'string') {
          setRelayUrlInput(snap.config.relayUrl)
        }
      }, [snap && snap.config && snap.config.relayUrl])

      useEffect(() => {
        if (!snap || !snap.config) return
        setAccept(snap.config.acceptInteractions !== false)
        setShare(snap.config.shareBubbles !== false)
        setAcceptChat(snap.config.acceptChat !== false)
        setAcceptRawChat(snap.config.acceptRawChat !== false)
        setAcceptRemoteMusic(snap.config.acceptRemoteMusic === true)
        setSyncMusic(snap.config.syncMusic !== false)
        setUpdateCheckOn(snap.config.updateCheck !== false)
      }, [snap && snap.config && snap.config.acceptInteractions, snap && snap.config && snap.config.shareBubbles, snap && snap.config && snap.config.acceptChat, snap && snap.config && snap.config.acceptRawChat, snap && snap.config && snap.config.acceptRemoteMusic, snap && snap.config && snap.config.syncMusic, snap && snap.config && snap.config.updateCheck])

      const toast = (text) => {
        const id = Date.now() + Math.random()
        setToasts((list) => [...list, { id, text }].slice(-3))
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500)
      }

      const run = async (fn, okText) => {
        setBusy(true)
        setNotice('')
        try {
          const res = await fn()
          if (res && res.ok === false) {
            setNotice(res.reason || '操作失败')
            toast('操作失败：' + (res.reason || '未知原因'))
          } else if (okText) {
            toast(okText)
          }
          return res
        } finally {
          setBusy(false)
        }
      }

      const createCode = () =>
        run(async () => {
          const res = await getJson('/pairing/new', { method: 'POST', body: '{}' })
          if (res.ok) setNotice('配对码已生成：' + res.code)
          return res
        }, '配对码已生成')

      const joinCode = () =>
        run(async () => {
          const res = await getJson('/pairing', { method: 'POST', body: JSON.stringify({ code }) })
          if (res.ok) setNotice('已加入房间 ' + res.room)
          return res
        }, '已加入联机房间')

      const leave = () =>
        run(async () => {
          const res = await getJson('/leave', { method: 'POST', body: '{}' })
          setNotice('已断开联机')
          return res
        }, '已断开联机')

      const save = (patch) =>
        run(() => getJson('/config', { method: 'POST', body: JSON.stringify(patch) }), '设置已保存')

      const checkUpdate = () =>
        run(() => getJson('/update/check', { method: 'POST', body: '{}' }), '已检查更新')

      const [applying, setApplying] = useState(false)
      const applyUpdateNow = async () => {
        setApplying(true)
        setNotice('')
        try {
          const res = await getJson('/update/apply', { method: 'POST', body: '{}' })
          if (res && res.ok) {
            setNotice('已更新到 v' + res.updatedTo + '（备份在 ' + res.backup + '），重启 DSH 生效')
            toast('更新完成，重启 DSH 生效')
          } else {
            setNotice('更新失败：' + ((res && res.reason) || '未知原因'))
            toast('更新失败')
          }
        } catch (e) {
          setNotice('更新失败：' + String(e && e.message ? e.message : e))
        } finally {
          setApplying(false)
        }
      }

      const interact = (peer, intent, note, track) =>
        run(
          () =>
            getJson('/interact', {
              method: 'POST',
              body: JSON.stringify({ to: peer.deviceId, intent, note, ...(track ? { track } : {}) }),
            }),
          '已向 ' + peer.name + ' 发起交互',
        )

      // 多人联机：同一个动作一次发给房间里所有在线设备。
      const interactAll = (intent, note, track) =>
        run(
          async () => {
            const res = await getJson('/interact-all', {
              method: 'POST',
              body: JSON.stringify({ intent, note, ...(track ? { track } : {}) }),
            })
            if (res.ok) setNotice('已发给全房间 ' + res.sent + ' 台设备')
            return res
          },
          '已向全房间发起交互',
        )

      const shareMusicAll = async () => {
        let track = await currentMusicTrack()
        if (!track) {
          const now = await getJson('/music/now')
          if (now && now.ok === true && now.track) track = now.track
        }
        if (!track) {
          toast('本机没有正在播放的音乐')
          return
        }
        const artists = Array.isArray(track.artists) ? track.artists.join('/') : ''
        await interactAll('music', track.name + (artists ? ' - ' + artists : ''), track)
      }

      /** 立刻把本机正在播的曲子推给全房间，让对端 dsh-music-player 切到同一首。 */
      const syncMusicNow = () =>
        run(async () => {
          const track = await currentMusicTrack()
          if (!track) {
            setNotice('本机音乐播放器没有在播放')
            return { ok: false, reason: 'not-playing' }
          }
          const res = await getJson('/music/sync', {
            method: 'POST',
            body: JSON.stringify({ track }),
          })
          if (res && res.ok === false) {
            const map = { 'not-playing': '本机音乐播放器没有在播放', 'relay-offline': '还没有连上房间' }
            setNotice(map[res.reason] || '同步失败：' + (res.reason || '未知原因'))
          }
          return res
        }, '已把当前播放同步给房间')

      // 不用 window.prompt：DSH 桌面壳（Electron）里 prompt 被禁用，点了没反应。
      const openCompose = (peer, kind) => setCompose({ peer, kind, value: '' })

      const submitCompose = async () => {
        if (!compose) return
        const text = String(compose.value || '').trim()
        if (text === '') return
        const peer = compose.peer
        const kind = compose.kind
        setCompose(null)
        if (kind === 'note') {
          interact(peer, 'visit-note', text.slice(0, 40))
          return
        }
        const limit = 500
        if (peer.deviceId === '*') {
          run(
            () => getJson('/chat-all', { method: 'POST', body: JSON.stringify({ text: text.slice(0, limit), raw: true }) }),
            '已发到全房间',
          )
          return
        }
        run(
          () =>
            getJson('/chat', {
              method: 'POST',
              body: JSON.stringify({ to: peer.deviceId, text: text.slice(0, limit), raw: kind === 'raw' }),
            }),
          kind === 'ai' ? '消息已发出，等对方回话' : '文字消息已发出',
        )
      }

      const sendRaw = (peer) => {
        const text = String(drafts[peer.deviceId] || '').trim().slice(0, 500)
        if (text === '') return
        setDrafts((prev) => ({ ...prev, [peer.deviceId]: '' }))
        run(
          () => getJson('/chat', { method: 'POST', body: JSON.stringify({ to: peer.deviceId, text, raw: true }) }),
          '文字消息已发出',
        )
      }

      const playMusicShare = (item) => {
        // 在点击手势里直接交给音乐播放器（轮询稍后取意图），不要再叠一个隐藏 <audio>。
        if (snap && snap.config && snap.config.syncMusic === false) {
          void playSharedFromGesture(item.track, item.fromName)
        } else {
          lastDirectMusicAt = Date.now()
          void syncViaMusicPlayer(item.track, item.fromName)
        }
        return run(
          () => getJson('/music/play', { method: 'POST', body: JSON.stringify({ seq: item.seq }) }),
          '已请求播放同一首',
        )
      }

      if (snap === null && error === null) return h('div', { className: 'dpo-wrap' }, h('div', { className: 'dpo-muted' }, '正在读取联机状态…'))
      if (snap && snap.ok === false) {
        return h('div', { className: 'dpo-wrap' }, h('div', { className: 'dpo-err' }, '联机状态不可用：' + (snap.reason || '未知错误')))
      }

      const peers = (snap && snap.peers) || []
      const relay = (snap && snap.relay) || {}
      const pairing = (snap && snap.pairing) || {}
      const online = relay.status === 'online'
      const roomLabel = snap && snap.room ? snap.room.members + '/' + snap.room.capacity : String(peers.length + 1) + '/8'

      return h(
        'div',
        { className: 'dpo-wrap' },
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '桌宠联机'),
          h(
            'div',
            { className: 'dpo-row' },
            h('span', { className: online ? 'dpo-ok' : 'dpo-muted' }, online ? '● 中继已连接' : '○ 未连接'),
            h('span', { className: 'dpo-muted' }, relay.url || ''),
            relay.error ? h('span', { className: 'dpo-err' }, '错误：' + relay.error) : null,
          ),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 8 } },
            pairing.code
              ? h(
                  React.Fragment,
                  null,
                  h('span', { className: 'dpo-muted' }, '房间配对码'),
                  h('span', { className: 'dpo-code' }, pairing.code),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: leave }, '断开'),
                )
              : h(
                  React.Fragment,
                  null,
                  h('button', { className: 'dpo-btn primary', disabled: busy, onClick: createCode }, '生成配对码'),
                  h('input', {
                    className: 'dpo-input',
                    placeholder: '输入对方配对码',
                    value: code,
                    maxLength: 6,
                    onChange: (e) => setCode(e.target.value.toUpperCase()),
                  }),
                  h('button', { className: 'dpo-btn', disabled: busy || code.length !== 6, onClick: joinCode }, '加入'),
                ),
          ),
          notice ? h('div', { className: 'dpo-muted', style: { marginTop: 8 } }, notice) : null,
          !online && pairing.code
            ? h(
                'div',
                { className: 'dpo-err', style: { marginTop: 8 } },
                '中继未连接：地址填本机（127.0.0.1 或本机局域网 IP）时，启用后会自动在本机起中继（端口 7420）；跨机联机请把下方「中继地址」改成中继机器的局域网 IP，并在防火墙放行 TCP 7420。',
              )
            : null,
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h(
            'div',
            { className: 'dpo-title' },
            '在线设备（' + peers.length + '）' + (pairing.code ? ' · 房间 ' + roomLabel + ' 人' : ''),
          ),
          peers.length > 0
            ? h(
                'div',
                { className: 'dpo-row', style: { marginBottom: 8 } },
                h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interactAll('wave') }, '向全房间打招呼'),
                h('button', { className: 'dpo-btn', disabled: busy, onClick: shareMusicAll }, '共享音乐给全房间'),
                h(
                  'button',
                  {
                    className: 'dpo-btn',
                    disabled: busy,
                    onClick: () => openCompose({ deviceId: '*', name: '全房间' }, 'raw'),
                  },
                  '向全房间发文字',
                ),
              )
            : null,
          peers.length === 0
            ? h('div', { className: 'dpo-muted' }, '还没有设备在同一房间。让对方输入你上面的配对码，或输入对方的配对码。')
            : peers.map((peer) =>
                h(
                  'div',
                  { className: 'dpo-peer', key: peer.deviceId },
                  h(
                    'div',
                    { className: 'dpo-peer-main' },
                    h('div', { className: 'dpo-peer-name' }, peer.name + (peer.online ? '' : '（离线）')),
                    h(
                      'div',
                      { className: 'dpo-peer-meta' },
                      (peer.pet || '未知宠物') + (peer.version ? ' · v' + peer.version : ' · 版本未知'),
                    ),
                  ),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'wave') }, '打招呼'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'treat') }, '投喂'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'poke') }, '戳一下'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'hug') }, '抱抱'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => openCompose(peer, 'note') }, '留言'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => openCompose(peer, 'ai') }, 'AI 聊天'),
                ),
              ),
          (snap && Array.isArray(snap.reactions) ? snap.reactions : []).slice(0, 3).map((r) =>
            h(
              'div',
              { className: 'dpo-muted', key: r.msgId + r.at, style: { marginTop: 6 } },
              (r.ok ? '✓ ' : '✗ ') +
                '对方回执：' +
                (r.ok ? (r.mode === 'bubble' ? '已执行（对方忙碌，仅气泡）' : '已执行') : r.reason || '失败'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '跨机聊天'),
          peers.length === 0
            ? h('div', { className: 'dpo-muted' }, '配对之后，点上面设备行的「聊天」给你的宠物和对方的宠物牵根线。')
            : peers.map((peer) => {
                const list = (snap.chats && snap.chats[peer.deviceId]) || []
                return h(
                  'div',
                  { key: 'chat-' + peer.deviceId, style: { marginBottom: 10 } },
                  h('div', { className: 'dpo-peer-meta', style: { marginBottom: 4 } }, '与 ' + peer.name + ' 的对话'),
                  list.length === 0
                    ? h('div', { className: 'dpo-muted' }, '还没有消息')
                    : list.map((m) =>
                        h(
                          'div',
                          { className: 'dpo-chat-line', key: m.at + m.from },
                          h('span', { className: 'dpo-chat-time' }, formatChatTime(m.at)),
                          h('b', null, m.from === 'me' ? '我：' : peer.name + '：'),
                          m.text,
                          m.raw ? h('span', { className: 'dpo-muted' }, '（文字）') : null,
                        ),
                      ),
                  h(
                    'div',
                    { className: 'dpo-row', style: { marginTop: 4 } },
                    h('input', {
                      className: 'dpo-chat-input',
                      placeholder: '直接发一条文字（不经过模型）',
                      value: drafts[peer.deviceId] || '',
                      maxLength: 500,
                      onChange: (e) => setDrafts((prev) => ({ ...prev, [peer.deviceId]: e.target.value })),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter') sendRaw(peer)
                      },
                    }),
                    h(
                      'button',
                      {
                        className: 'dpo-btn primary',
                        disabled: busy || String(drafts[peer.deviceId] || '').trim() === '',
                        onClick: () => sendRaw(peer),
                      },
                      '发送',
                    ),
                    h('button', { className: 'dpo-btn', disabled: busy, onClick: () => openCompose(peer, 'ai') }, 'AI 回复'),
                  ),
                )
              }),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 4 } },
            h(
              'label',
              { className: 'dpo-row' },
              h('input', {
                type: 'checkbox',
                checked: acceptChat,
                onChange: (e) => {
                  setAcceptChat(e.target.checked)
                  save({ acceptChat: e.target.checked })
                },
              }),
              '接受别人和我的宠物聊天（会用你的模型 token）',
            ),
          ),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 4 } },
            h(
              'label',
              { className: 'dpo-row' },
              h('input', {
                type: 'checkbox',
                checked: acceptRawChat,
                onChange: (e) => {
                  setAcceptRawChat(e.target.checked)
                  save({ acceptRawChat: e.target.checked })
                },
              }),
              '接受纯文字消息（不经过模型，不消耗 token）',
            ),
          ),
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '音乐分享'),
          (snap && Array.isArray(snap.musicShares) ? snap.musicShares : []).length === 0
            ? h('div', { className: 'dpo-muted' }, '暂无人分享音乐。在访客宠物上右键可以「共享当前音乐」。')
            : (snap.musicShares || []).map((item) =>
                h(
                  'div',
                  { className: 'dpo-row', key: 'share-' + item.seq, style: { marginBottom: 4 } },
                  h(
                    'span',
                    { className: 'dpo-muted' },
                    item.fromName + ' 分享了《' + item.track.name + (item.track.artists && item.track.artists.length > 0 ? ' - ' + item.track.artists.join('/') : '') + '》',
                  ),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => playMusicShare(item) }, '播放同一首'),
                ),
              ),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 4 } },
            h(
              'label',
              { className: 'dpo-row' },
              h('input', {
                type: 'checkbox',
                checked: acceptRemoteMusic,
                onChange: (e) => {
                  setAcceptRemoteMusic(e.target.checked)
                  // 勾选本身就是用户手势：顺手解锁自动播放，之后对方分享才能自动响。
                  if (e.target.checked) unlockSharedAudio()
                  save({ acceptRemoteMusic: e.target.checked })
                },
              }),
              '允许对方让我播放同一首（自动播放，仅本机曲库/已登录在线源）',
            ),
          ),
          shared.hidden && shared.title !== ''
            ? h(
                'button',
                { className: 'dpo-btn', style: { marginTop: 4 }, onClick: () => sharedSet({ hidden: false }) },
                '显示共享播放条',
              )
            : null,
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 4 } },
            h(
              'label',
              { className: 'dpo-row' },
              h('input', {
                type: 'checkbox',
                checked: syncMusic,
                onChange: (e) => {
                  setSyncMusic(e.target.checked)
                  save({ syncMusic: e.target.checked })
                },
              }),
              '跟随房间同步播放（一侧切歌，另一侧用 dsh-music-player 切到同一首）',
            ),
          ),
          h(
            'div',
            { className: 'dpo-row' },
            h('button', { className: 'dpo-btn', disabled: busy, onClick: syncMusicNow }, '同步我的当前播放'),
            snap.musicSync && snap.musicSync.track
              ? h(
                  'span',
                  { className: 'dpo-muted' },
                  '最近同步：' + snap.musicSync.fromName + '《' + snap.musicSync.track.name + '》',
                )
              : null,
          ),
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '版本与更新'),
          h(
            'div',
            { className: 'dpo-row' },
            h('span', { className: 'dpo-muted' }, '当前 v' + (snap.pluginVersion || '?')),
            snap.update && snap.update.latest
              ? h(
                  'span',
                  { className: snap.update.hasUpdate ? 'dpo-err' : 'dpo-muted' },
                  (snap.update.hasUpdate ? '发现新版本 v' : '最新 v') + snap.update.latest,
                )
              : h('span', { className: 'dpo-muted' }, '尚未检查'),
            snap.update && snap.update.error
              ? h('span', { className: 'dpo-muted' }, '（检查失败：' + snap.update.error + '）')
              : null,
          ),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 8 } },
            h('button', { className: 'dpo-btn', disabled: busy, onClick: checkUpdate }, '检查更新'),
            snap.update && snap.update.hasUpdate
              ? h(
                  'button',
                  { className: 'dpo-btn primary', disabled: busy || applying, onClick: applyUpdateNow },
                  applying ? '更新中…' : '一键更新',
                )
              : null,
            snap.update && snap.update.hasUpdate && snap.update.url
              ? h(
                  'a',
                  {
                    className: 'dpo-btn',
                    href: snap.update.url,
                    target: '_blank',
                    rel: 'noreferrer',
                  },
                  '去下载',
                )
              : null,
          ),
          h(
            'div',
            { className: 'dpo-muted', style: { marginTop: 6 } },
            '更新包从 GitHub Release 下载；装好后重启 DSH 生效。每 6 小时自动检查一次。',
          ),
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '偏好'),
          h(
            'div',
            { className: 'dpo-row' },
            h('label', { className: 'dpo-row' }, h('input', { type: 'checkbox', checked: accept, onChange: (e) => { setAccept(e.target.checked); save({ acceptInteractions: e.target.checked }) } }), '接受别人和我的宠物互动'),
          ),
          h(
            'div',
            { className: 'dpo-row' },
            h('label', { className: 'dpo-row' }, h('input', { type: 'checkbox', checked: share, onChange: (e) => { setShare(e.target.checked); save({ shareBubbles: e.target.checked }) } }), '向联机设备共享宠物气泡文字'),
          ),
          h(
            'div',
            { className: 'dpo-row' },
            h(
              'label',
              { className: 'dpo-row' },
              h('input', {
                type: 'checkbox',
                checked: updateCheckOn,
                onChange: (e) => {
                  setUpdateCheckOn(e.target.checked)
                  save({ updateCheck: e.target.checked })
                },
              }),
              '自动检查更新（GitHub Release，每 6 小时）',
            ),
          ),
          h('div', { className: 'dpo-muted', style: { marginTop: 8 } }, '联机数据只含宠物名、大小、动作与气泡；不含对话记忆、文件或账号信息。'),
          h(
            'div',
            { className: 'dpo-row', style: { marginTop: 10 } },
            h('span', { className: 'dpo-muted' }, '中继地址'),
            h('input', {
              className: 'dpo-input',
              style: { width: 240, letterSpacing: 0, textTransform: 'none' },
              value: relayUrlInput,
              placeholder: 'ws://192.168.1.10:7420/ws',
              onChange: (e) => setRelayUrlInput(e.target.value),
            }),
            h(
              'button',
              { className: 'dpo-btn', disabled: busy, onClick: () => save({ relayUrl: relayUrlInput.trim() }) },
              '保存',
            ),
          ),
          h('div', { className: 'dpo-muted', style: { marginTop: 6 } }, '同机自测留 127.0.0.1；跨机填中继那台机器的局域网 IP。'),
        ),
        toasts.length > 0
          ? h('div', { className: 'dpo-toast' }, toasts.map((t) => h('div', { className: 'dpo-toast-item', key: t.id }, t.text)))
          : null,
        compose !== null
          ? h(
              'div',
              { className: 'dpo-compose', onPointerDown: (e) => e.stopPropagation() },
              h(
                'div',
                { className: 'dpo-compose-title' },
                compose.kind === 'note'
                  ? '给 ' + compose.peer.name + ' 留句话'
                  : compose.kind === 'ai'
                    ? '跟 ' + compose.peer.name + ' 的宠物说句话'
                    : '给 ' + compose.peer.name + ' 发条消息（不经过模型）',
              ),
              h('textarea', {
                className: 'dpo-compose-input',
                autoFocus: true,
                maxLength: compose.kind === 'note' ? 40 : 500,
                value: compose.value,
                onChange: (e) => setCompose({ ...compose, value: e.target.value }),
                onKeyDown: (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submitCompose()
                  } else if (e.key === 'Escape') {
                    setCompose(null)
                  }
                },
              }),
              h(
                'div',
                { className: 'dpo-compose-hint' },
                compose.kind === 'ai' ? '会调用对方桌宠的 LLM，回复显示在它的气泡里' : compose.kind === 'raw' ? '直接送达对方，不经过模型' : '对方宠物会冒泡读出来',
              ),
              h(
                'div',
                { className: 'dpo-compose-actions' },
                h('button', { className: 'dpo-btn', onClick: () => setCompose(null) }, '取消'),
                h('button', { className: 'dpo-btn primary', onClick: () => void submitCompose() }, '发送'),
              ),
            )
          : null,
      )
    }

    /** 覆盖层：长轮询 /events，拿到远端宠物后渲染访客精灵。 */
    function useOverlay() {
      const [snap, setSnap] = useState(null)
      useEffect(() => {
        let alive = true
        let controller = null
        let since = 0
        const loop = async () => {
          while (alive) {
            try {
              controller = new AbortController()
              const res = await fetch(BASE + '/events?since=' + since + '&timeout=10000', {
                signal: controller.signal,
                cache: 'no-store',
                credentials: 'same-origin',
              })
              const data = await res.json()
              if (!alive) return
              if (data && data.ok) {
                since = typeof data.version === 'number' ? data.version : 0
                setSnap(data)
              }
            } catch {
              if (!alive) return
              await new Promise((r) => setTimeout(r, 1500))
            }
          }
        }
        loop()
        return () => {
          alive = false
          try {
            controller?.abort()
          } catch {
            /* ignore */
          }
        }
      }, [])
      return snap
    }

    /**
     * 本机动作探针 + 音乐插件旁路。
     * 关键点：包装函数只装一次，具体行为放在 window.__dpoHooks 里。
     * 插件热更新后模块闭包会换新，但旧包装还挂在 window.fetch 上——若把状态闭包在
     * 包装函数里，新的 musicIntentOverride 永远读不到，表现为「对端切歌后播放器不动，
     * 只有内置播放器偶尔出声」。所以每次加载都刷新 hooks，包装统一从 hooks 取。
     */
    function installAnimProbe() {
      if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
      const hooks = window.__dpoHooks || (window.__dpoHooks = {})
      hooks.onPrefs = (parsed) => {
        mergeMusicPrefs(parsed && parsed.prefs, parsed && parsed.remove)
        scheduleAutoMusicSync(readTrackFromPrefs(musicPrefsCache))
      }
      hooks.onPrefsGet = (data) => {
        if (data && data.prefs && typeof data.prefs === 'object') {
          mergeMusicPrefs(data.prefs)
          scheduleAutoMusicSync(readTrackFromPrefs(musicPrefsCache))
        }
      }
      hooks.takeIntent = () => {
        if (musicIntentOverride === null) return null
        const intent = musicIntentOverride
        musicIntentOverride = null
        if (musicIntentFallback !== null) {
          clearTimeout(musicIntentFallback)
          musicIntentFallback = null
        }
        return intent
      }
      hooks.onAnim = (name) => {
        void fetch(BASE + '/local-action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ anim: name }),
        }).catch(() => {})
      }
      if (window.__dpoFetchWrapped === true) return
      window.__dpoFetchWrapped = true
      const original = window.fetch.bind(window)
      let lastName = ''
      let lastAt = 0
      window.fetch = function patchedFetch(input, init) {
        try {
          const url = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : ''
          // 跟着 dsh-music-player 自己的 prefs 写入，保持一份最新的「正在播放」快照。
          if (/\/dsh-music\/prefs(\?|$)/.test(url)) {
            const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase()
            if (method === 'POST') {
              try {
                const body = init && typeof init.body === 'string' ? init.body : ''
                if (body !== '') hooks.onPrefs(JSON.parse(body))
              } catch {
                /* 不是 JSON 就忽略 */
              }
            } else if (method === 'GET') {
              const pending = original(input, init)
              void pending
                .then((res) => res.clone().json())
                .then((data) => hooks.onPrefsGet(data))
                .catch(() => {})
              return pending
            }
          }
          // 对端切歌：把待播意图喂给 dsh-music-player 的 /intent 轮询，让它自己播。
          if (/\/dsh-music\/intent(\?|$)/.test(url)) {
            const intent = hooks.takeIntent()
            if (intent !== null) {
              return new Response(JSON.stringify(intent), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              })
            }
          }
          if (!(init && init.__dpo === true)) {
            const match = /\/dsh-pet-7340\/thumb\/[^/]+\/([^/]+)\.(webm|mov)$/.exec(url)
            if (match) {
              const name = decodeURIComponent(match[1])
              const now = Date.now()
              if (name !== lastName && now - lastAt > 200) {
                lastName = name
                lastAt = now
                hooks.onAnim(name)
              }
            }
          }
        } catch {
          /* 探针失败绝不影响正常请求 */
        }
        return original(input, init)
      }
    }

    /** 一段远端动画：blob 加载后交给 <video>；动作名缺失时回落到对方上报的待机动画，
     *  再不行就显示本机 dsh-pet 的角色图，保证访客精灵不会是「空白 + 名字」。 */
    function RemoteClip(props) {
      const { assetRoot, anim, fallback, width } = props
      const candidates = [anim, fallback].filter(
        (value, index, list) => typeof value === 'string' && value !== '' && list.indexOf(value) === index,
      )
      const height = Math.round((width * 9) / 16)
      const videoRef = React.useRef(null)
      const [ready, setReady] = useState(false)
      const [failed, setFailed] = useState(candidates.length === 0)

      useEffect(() => {
        let alive = true
        let objectUrl = null
        const controller = new AbortController()
        setFailed(false)
        setReady(false)

        const tryDirect = (src) => {
          if (!videoRef.current) return false
          videoRef.current.src = src
          videoRef.current.load()
          videoRef.current.play().catch(() => {})
          setReady(true)
          return true
        }

        const load = async () => {
          for (const name of candidates) {
            if (/^https?:\/\//.test(name)) {
              if (alive && tryDirect(name)) return
              continue
            }
            for (const ext of ['webm', 'mov']) {
              try {
                const url =
                  '/dsh-pet-7340/thumb/' +
                  encodeURIComponent(assetRoot || 'main') +
                  '/' +
                  encodeURIComponent(name) +
                  '.' +
                  ext
                const res = await fetch(url, { cache: 'default', signal: controller.signal, __dpo: true })
                if (!res.ok) continue
                const blob = await res.blob()
                if (!alive) return
                objectUrl = URL.createObjectURL(blob)
                if (videoRef.current) {
                  videoRef.current.src = objectUrl
                  videoRef.current.load()
                  videoRef.current.play().catch(() => {})
                }
                setReady(true)
                return
              } catch {
                /* try next */
              }
            }
          }
          if (alive) setFailed(true)
        }

        load()
        return () => {
          alive = false
          controller.abort()
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
      }, [assetRoot, candidates.join('|')])

      return h(
        'div',
        { style: { position: 'relative', width, height } },
        failed || !ready
          ? h('img', {
              src: '/dsh-pet-7340/character?root=' + encodeURIComponent(assetRoot || 'main'),
              width,
              height,
              draggable: false,
              alt: '',
              style: { width, height, objectFit: 'contain', opacity: failed ? 0.9 : 0.45 },
            })
          : null,
        h('video', {
          ref: videoRef,
          width,
          height,
          muted: true,
          autoPlay: true,
          loop: true,
          playsInline: true,
          style: {
            position: 'absolute',
            inset: 0,
            width,
            height,
            opacity: ready ? 1 : 0,
            transition: 'opacity .2s ease',
          },
        }),
      )
    }

    /** 访客精灵的本地物理：重力、落地回弹、左右壁反弹、彼此碰撞、拖拽抛掷。 */
    function useGuestBodies() {
      const bodies = React.useRef(new Map())

      React.useEffect(() => {
        let raf = 0
        let last = performance.now()
        const step = (now) => {
          const dt = Math.min(0.05, (now - last) / 1000)
          last = now
          const list = [...bodies.current.values()]
          for (const b of list) {
            if (b.drag) continue
            b.vy += 1400 * dt
            b.x += b.vx * dt
            b.y += b.vy * dt
            const maxX = window.innerWidth - b.w
            const maxY = window.innerHeight - b.h
            if (b.x < 0) {
              b.x = 0
              b.vx = Math.abs(b.vx) * 0.78
            } else if (b.x > maxX) {
              b.x = maxX
              b.vx = -Math.abs(b.vx) * 0.78
            }
            if (b.y > maxY) {
              b.y = maxY
              b.vy = -Math.abs(b.vy) * 0.78
              b.vx *= 0.9
              if (Math.abs(b.vx) < 6) b.vx += (Math.random() - 0.5) * 2
            } else if (b.y < 0) {
              b.y = 0
              b.vy = Math.abs(b.vy) * 0.78
            }
          }
          for (let i = 0; i < list.length; i += 1) {
            for (let j = i + 1; j < list.length; j += 1) {
              const a = list[i]
              const b = list[j]
              const dx = b.x - a.x
              const dy = b.y - a.y
              const min = (a.w + b.w) * 0.32
              const dist = Math.hypot(dx, dy)
              if (dist > 0 && dist < min) {
                const push = (min - dist) * 0.5
                const nx = dx / dist
                const ny = dy / dist
                a.x -= nx * push
                a.y -= ny * push
                b.x += nx * push
                b.y += ny * push
                a.vx -= nx * 40
                b.vx += nx * 40
              }
            }
          }
          for (const b of list) {
            if (b.el) b.el.style.transform = 'translate(' + Math.round(b.x) + 'px,' + Math.round(b.y) + 'px)'
          }
          raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf)
      }, [])

      return bodies
    }

    function GuestPet(props) {
      const { peer, pet, index, bodies, onMenu } = props
      const width = Math.min(340, Math.max(120, Math.round((pet.size || 320) * 0.36)))
      const height = Math.round((width * 9) / 16)
      const key = peer.deviceId + ':' + pet.id
      const drag = React.useRef(null)

      const bind = (el) => {
        if (!el) return
        const map = bodies.current
        let body = map.get(key)
        if (!body) {
          const left = typeof pet.x === 'number' ? pet.x : 0.55 + (index % 3) * 0.12
          const top = typeof pet.y === 'number' ? pet.y : 0.78
          body = { x: left * window.innerWidth, y: top * window.innerHeight, vx: 0, vy: 0, w: width, h: height }
          map.set(key, body)
        }
        body.el = el
        body.w = width
        body.h = height
        el.style.transform = 'translate(' + Math.round(body.x) + 'px,' + Math.round(body.y) + 'px)'
      }

      const poke = () => {
        void fetch(BASE + '/interact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ to: peer.deviceId, intent: 'poke' }),
        }).catch(() => {})
      }

      React.useEffect(() => {
        const body = bodies.current.get(key)
        if (!body || body.drag) return
        if (typeof pet.x === 'number') body.x = pet.x * window.innerWidth
        if (typeof pet.y === 'number') body.y = pet.y * window.innerHeight
      }, [pet.x, pet.y])

      const onDown = (e) => {
        // 只接管左键：右键要留给 contextmenu（被 preventDefault 取消的 pointerdown 会吞掉右击菜单）。
        if (e.button !== 0) return
        const body = bodies.current.get(key)
        if (!body) return
        body.drag = true
        drag.current = { x: e.clientX, y: e.clientY, bx: body.x, by: body.y, t: Date.now(), moved: 0, lx: e.clientX, ly: e.clientY }
        e.currentTarget.setPointerCapture?.(e.pointerId)
        e.preventDefault()
      }
      const onMove = (e) => {
        const body = bodies.current.get(key)
        const d = drag.current
        if (!body || !d) return
        d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.x, e.clientY - d.y))
        body.x = d.bx + (e.clientX - d.x)
        body.y = d.by + (e.clientY - d.y)
        d.lx = e.clientX
        d.ly = e.clientY
      }
      const onUp = (e) => {
        const body = bodies.current.get(key)
        const d = drag.current
        drag.current = null
        if (!body || !d) return
        body.drag = false
        const dt = Math.max(0.02, (Date.now() - d.t) / 1000)
        body.vx = ((e.clientX - d.lx) / dt) * 0.6
        body.vy = ((e.clientY - d.ly) / dt) * 0.6
        if (d.moved < 5) poke()
      }

      return h(
        'div',
        {
          ref: bind,
          className: 'dpo-guest' + (pet.sleeping ? ' dpo-sleeping' : ''),
          style: { width, height, pointerEvents: 'auto', cursor: 'grab' },
          title: peer.name + ' 的宠物（可拖动抛掷，点一下戳它，右击打开菜单）',
          onPointerDown: onDown,
          onPointerMove: onMove,
          onPointerUp: onUp,
          onPointerCancel: onUp,
          onContextMenu: (e) => {
            e.preventDefault()
            e.stopPropagation()
            onMenu?.(peer, e.clientX, e.clientY)
          },
        },
        pet.bubble
          ? h(
              'div',
              { className: 'dpo-guest-bubble' + (pet.bubbleImage ? ' has-img' : '') },
              [
                pet.bubbleImage
                  ? h('img', {
                      key: 'img',
                      className: 'dpo-guest-bubble-img',
                      alt: pet.bubbleImage,
                      src:
                        '/dsh-pet-7340/pic/memes/' +
                        encodeURIComponent(pet.assetRoot || 'main') +
                        '/' +
                        encodeURIComponent(pet.bubbleImage) +
                        '.png',
                      onError: (e) => {
                        e.currentTarget.style.display = 'none'
                      },
                    })
                  : null,
                h('span', { key: 'text' }, pet.bubble),
              ],
            )
          : null,
        pet.sleeping ? h('div', { className: 'dpo-guest-zzz' }, '💤') : null,
        h(RemoteClip, { assetRoot: pet.assetRoot, anim: pet.anim, fallback: pet.idle, width }),
        h('div', { className: 'dpo-guest-name' }, peer.name),
      )
    }

    function guestMenu(peer) {
      const pet = (Array.isArray(peer.pets) ? peer.pets[0] : null) || {}
      const actions = Array.isArray(pet.actions) ? pet.actions : []
      return [
        { intent: 'wave', label: '打招呼' },
        { intent: 'treat', label: '投喂零食' },
        { intent: 'pet', label: '摸摸头' },
        { intent: 'poke', label: '戳一下' },
        { intent: 'hug', label: '抱抱' },
        { intent: pet.sleeping ? 'wake' : 'sleep', label: pet.sleeping ? '叫醒它' : '哄它睡觉' },
        { intent: 'action-menu', label: actions.length > 0 ? '动作…' : '动作（无可用动作）', disabled: actions.length === 0 },
        { intent: 'music', label: '共享当前音乐' },
        { intent: 'visit-note', label: '留言…' },
        { intent: 'chat-raw', label: '发文字消息…' },
        { intent: 'chat-ai', label: 'AI 聊天…' },
      ]
    }

    /** 把 reaction/接口里的 reason 翻成人话，互动失败时直接弹出来。 */
    const REACTION_TEXT = {
      sleeping: '对方宠物睡着了，先叫醒它',
      locked: '对方正在和宠物互动，稍后再试',
      'unknown-animation': '对方没有这个动作',
      'pet-call-failed': '对方桌宠没有响应',
      'no-pet': '对方没有可互动的宠物',
      declined: '对方关闭了互动',
      'rate-limited': '发送太频繁，稍后再试',
      'unknown-peer': '对方已离线',
      'relay-offline': '中继未连接',
      'chat-failed': '对方聊天没有响应',
      'already-sleeping': '它已经睡着了',
    }
    const reasonText = (reason) => REACTION_TEXT[reason] || '操作失败：' + (reason || '未知原因')

    function GuestLayer() {
      const snap = useOverlay()
      const bodies = useGuestBodies()
      const [menu, setMenu] = useState(null)
      const [submenu, setSubmenu] = useState(null)
      const [compose, setCompose] = useState(null)
      const [toast, setToast] = useState('')
      const toastTimer = React.useRef(0)
      const playedMusicSeq = React.useRef(0)
      const playedSyncSeq = React.useRef(0)
      const playedSyncPosSeq = React.useRef(0)
      const lastReactionMsg = React.useRef('')
      const shared = useSharedMusic()

      React.useEffect(() => {
        const music = snap && snap.music
        if (!music || !music.track || typeof music.seq !== 'number') return
        if (playedMusicSeq.current >= music.seq) return
        playedMusicSeq.current = music.seq
        // 面板按钮已经在这个手势里播了同一首，轮询回来的同一条请求不再打断重播。
        if (Date.now() - lastDirectMusicAt < 5000) return
        // 分享音乐也要走音乐播放器（同一首/同一进度），不要另开一个隐藏 <audio>。
        if (snap.config && snap.config.syncMusic !== false) void syncViaMusicPlayer(music.track, music.fromName)
        else void playSharedTrack(music.track, music.fromName)
      }, [snap && snap.music && snap.music.seq])

      // 对端切歌：优先让 dsh-music-player 自己切过去，插件不再叠一个 <audio>。
      React.useEffect(() => {
        const sync = snap && snap.musicSync
        if (!sync || !sync.track || typeof sync.seq !== 'number') return
        lastRemoteSyncAt = Date.now()
        if (playedSyncSeq.current >= sync.seq) return
        playedSyncSeq.current = sync.seq
        if (snap.config && snap.config.syncMusic === false) return
        void syncViaMusicPlayer(sync.track, sync.fromName)
      }, [snap && snap.musicSync && snap.musicSync.seq])

      // 同一首的进度心跳：对端播到 1:30，本机也校准到 1:30，不重新起播。
      React.useEffect(() => {
        const sync = snap && snap.musicSync
        if (!sync || !sync.track || typeof sync.posSeq !== 'number') return
        lastRemoteSyncAt = Date.now()
        if (playedSyncPosSeq.current >= sync.posSeq) return
        playedSyncPosSeq.current = sync.posSeq
        if (snap.config && snap.config.syncMusic === false) return
        if (Date.now() - lastRemoteApplyAt < 2_500) return
        void alignRemotePosition(sync.track)
      }, [snap && snap.musicSync && snap.musicSync.posSeq])

      // 页面里第一次点击时顺手解锁音频：之后即使是对端自动推来的歌也能直接响。
      React.useEffect(() => {
        const unlock = () => unlockSharedAudio()
        document.addEventListener('pointerdown', unlock, { capture: true, once: true })
        return () => document.removeEventListener('pointerdown', unlock, true)
      }, [])

      // 对方回执失败时把原因亮出来（例如「对方宠物睡着了」）
      React.useEffect(() => {
        const list = snap && Array.isArray(snap.reactions) ? snap.reactions : []
        const top = list[0]
        if (!top || typeof top.msgId !== 'string') return
        if (lastReactionMsg.current === '') {
          lastReactionMsg.current = top.msgId
          return
        }
        if (lastReactionMsg.current === top.msgId) return
        lastReactionMsg.current = top.msgId
        if (top.ok === false) showToast(reasonText(top.reason))
      }, [snap && snap.reactions && snap.reactions[0] && snap.reactions[0].msgId])

      const showToast = (text) => {
        setToast(text)
        clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 3000)
      }

      const sendIntent = async (peer, intent, note, track) => {
        try {
          const res = await fetch(BASE + '/interact', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: peer.deviceId, intent, note, ...(track ? { track } : {}) }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data.ok !== true) {
            showToast(reasonText(data.reason || 'send-failed'))
            return false
          }
          return true
        } catch {
          showToast('发送失败：中继没有连上')
          return false
        }
      }

      const shareMusic = async (peer) => {
        try {
          // 优先用页面内截获的播放器 prefs 快照：宿主快照有 800ms 防抖，刚切歌时会误报「没有在播放」。
          let track = await currentMusicTrack()
          if (!track) {
            const res = await fetch(BASE + '/music/now', { cache: 'no-store' })
            const data = await res.json()
            if (data && data.ok === true && data.track) track = data.track
          }
          if (!track) {
            showToast('音乐播放器当前没有在播放音乐')
            return
          }
          const label =
            track.name + (track.artists && track.artists.length > 0 ? ' - ' + track.artists.join('/') : '')
          if (await sendIntent(peer, 'music', label.slice(0, 40), track)) showToast('已共享：' + label)
        } catch {
          showToast('共享音乐失败')
        }
      }

      const submitCompose = async () => {
        if (!compose) return
        const text = String(compose.value || '').trim()
        if (text === '') return
        const peer = compose.peer
        const kind = compose.kind
        setCompose(null)
        if (kind === 'note') {
          await sendIntent(peer, 'visit-note', text.slice(0, 40))
          return
        }
        try {
          const res = await fetch(BASE + '/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ to: peer.deviceId, text: text.slice(0, 120), raw: kind === 'raw' }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data.ok !== true) showToast(reasonText(data.reason || 'chat-failed'))
          else showToast(kind === 'ai' ? '已发给对方桌宠，等它回复' : '消息已送达')
        } catch {
          showToast('发送失败：中继没有连上')
        }
      }

      const pick = async (item) => {
        const peer = menu
        if (!peer) return
        if (item.intent === 'action-menu') {
          setSubmenu('action')
          return
        }
        if (item.intent === 'actions-back') {
          setSubmenu(null)
          return
        }
        setMenu(null)
        setSubmenu(null)
        if (item.intent === 'music') return shareMusic(peer.peer)
        // 不用 window.prompt：DSH 桌面壳（Electron）里 prompt 被禁用，会直接报错/无反应。
        if (item.intent === 'visit-note') {
          setCompose({ peer: peer.peer, kind: 'note', value: '' })
          return
        }
        if (item.intent === 'chat-raw' || item.intent === 'chat-ai') {
          setCompose({ peer: peer.peer, kind: item.intent === 'chat-ai' ? 'ai' : 'raw', value: '' })
          return
        }
        if (item.intent === 'action') return sendIntent(peer.peer, 'action', item.note)
        await sendIntent(peer.peer, item.intent)
      }

      if (!snap || !Array.isArray(snap.peers)) return null
      const sprites = []
      let index = 0
      for (const peer of snap.peers) {
        if (peer.online === false) continue
        for (const pet of Array.isArray(peer.pets) ? peer.pets : []) {
          sprites.push(
            h(GuestPet, {
              key: peer.deviceId + ':' + pet.id,
              peer,
              pet,
              index,
              bodies,
              onMenu: (target, x, y) => setMenu({ peer: target, x, y }),
            }),
          )
          index += 1
        }
      }
      const menuWidth = 190
      const menuTop = menu ? Math.min(menu.y, window.innerHeight - 320) : 0
      const menuLeft = menu ? Math.min(menu.x, window.innerWidth - menuWidth - 8) : 0
      const menuItems = menu === null
        ? []
        : submenu === 'action'
          ? [
              { intent: 'actions-back', label: '← 返回' },
              ...((Array.isArray(menu.peer.pets) && menu.peer.pets[0] && Array.isArray(menu.peer.pets[0].actions) ? menu.peer.pets[0].actions : []).map((name) => ({
                intent: 'action',
                note: name,
                label: name,
              }))),
            ]
          : guestMenu(menu.peer)
      const hasContent = sprites.length > 0 || menu !== null || (shared.title !== '' && !shared.hidden) || compose !== null
      return hasContent
        ? h(
            'div',
            { className: 'dpo-guest-layer' + (menu !== null ? ' dpo-menu-open' : '') },
            sprites,
            menu !== null
              ? h(
                  React.Fragment,
                  null,
                  h('div', { className: 'dpo-menu-backdrop', onPointerDown: () => { setMenu(null); setSubmenu(null) } }),
                  h(
                    'div',
                    {
                      className: 'dpo-menu',
                      style: { left: menuLeft, top: menuTop, width: menuWidth },
                      onPointerDown: (e) => e.stopPropagation(),
                      onContextMenu: (e) => e.preventDefault(),
                    },
                    h('div', { className: 'dpo-menu-title' }, menu.peer.name),
                    menuItems.map((item) =>
                      h(
                        'button',
                        {
                          key: item.intent + (item.note || ''),
                          className: 'dpo-menu-item',
                          disabled: item.disabled === true,
                          onClick: () => pick(item),
                        },
                        item.label,
                      ),
                    ),
                  ),
                )
              : null,
            compose !== null
              ? h(
                  'div',
                  {
                    className: 'dpo-compose',
                    onPointerDown: (e) => e.stopPropagation(),
                    onContextMenu: (e) => e.preventDefault(),
                  },
                  h(
                    'div',
                    { className: 'dpo-compose-title' },
                    compose.kind === 'note'
                      ? '给 ' + compose.peer.name + ' 留句话'
                      : compose.kind === 'ai'
                        ? '让 ' + compose.peer.name + ' 的桌宠回你'
                        : '给 ' + compose.peer.name + ' 发条消息',
                  ),
                  h('textarea', {
                    className: 'dpo-compose-input',
                    autoFocus: true,
                    maxLength: compose.kind === 'note' ? 40 : 120,
                    placeholder: compose.kind === 'ai' ? '它会用自己的模型人设回复' : '输入后按 Enter 发送，Shift+Enter 换行',
                    value: compose.value,
                    onChange: (e) => setCompose({ ...compose, value: e.target.value }),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void submitCompose()
                      } else if (e.key === 'Escape') {
                        setCompose(null)
                      }
                    },
                  }),
                  h(
                    'div',
                    { className: 'dpo-compose-hint' },
                    compose.kind === 'ai'
                      ? '会调用对方桌宠的 LLM，回复显示在它的气泡里'
                      : compose.kind === 'raw'
                        ? '直接送达对方，不经过模型'
                        : '对方宠物会冒泡读出来',
                  ),
                  h(
                    'div',
                    { className: 'dpo-compose-actions' },
                    h('button', { className: 'dpo-btn', onClick: () => setCompose(null) }, '取消'),
                    h('button', { className: 'dpo-btn primary', onClick: () => void submitCompose() }, '发送'),
                  ),
                )
              : null,
            shared.title !== '' && !shared.hidden
              ? h(
                  'div',
                  { className: 'dpo-share-music' },
                  h(
                    'button',
                    {
                      className: 'dpo-share-music-close',
                      title: '隐藏播放条（下一首共享时会重新出现）',
                      onClick: () => sharedSet({ hidden: true }),
                    },
                    '×',
                  ),
                  h('div', { className: 'dpo-share-music-title' }, '♪ ' + shared.title),
                  h(
                    'div',
                    { className: 'dpo-muted' },
                    (shared.fromName ? '来自 ' + shared.fromName + ' · ' : '') +
                      (shared.error !== '' ? shared.error : shared.playing ? '播放中' : '已停止'),
                  ),
                  h(
                    'div',
                    { className: 'dpo-row', style: { marginTop: 4 } },
                    shared.blocked && shared.track
                      ? h(
                          'button',
                          {
                            className: 'dpo-btn primary',
                            onClick: () => {
                              // 播放器路径被拦截时，重试也要走音乐播放器；只有内置播放器才用直接播放。
                              if (shared.error.includes('音乐播放器')) {
                                void syncViaMusicPlayer(shared.track, shared.fromName)
                              } else {
                                void playSharedFromGesture(shared.track, shared.fromName)
                              }
                            },
                          },
                          '重试',
                        )
                      : null,
                    h('button', { className: 'dpo-btn', onClick: stopSharedPlayback }, '停止'),
                  ),
                )
              : null,
            toast !== '' ? h('div', { className: 'dpo-overlay-toast' }, toast) : null,
          )
        : null
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        installAnimProbe()
        const disposeCss = installStyles()
        ctx.effect(() => () => disposeCss(), 'dsh-pet-online: styles')
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-pet-online',
              order: 136,
              label: () => '桌宠联机',
            },
            Panel,
          ),
        )
        // 远端宠物投影：挂在全屏浮动层，pointer-events 全部放行，不挡本机桌宠。
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-pet-online-guests',
              order: 1002,
            },
            GuestLayer,
          ),
        )
      },
    }
  },
})
