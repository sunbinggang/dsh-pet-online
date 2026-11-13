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
      '.dpo-card{border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.25));border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1,rgba(15,23,42,.35))}',
      '.dpo-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dpo-title{font-weight:600;font-size:14px;margin-bottom:6px}',
      '.dpo-muted{color:var(--dsw-alias-label-secondary,#94a3b8);font-size:12px}',
      '.dpo-btn{border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));background:transparent;color:inherit;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}',
      '.dpo-btn.primary{background:var(--dsw-alias-brand-primary,#2f6df6);color:#fff;border-color:transparent}',
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
      '.dpo-guest{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;will-change:transform;touch-action:none}',
      '.dpo-guest video{display:block;pointer-events:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.18))}',
      '.dpo-guest-bubble{position:absolute;bottom:100%;margin-bottom:6px;max-width:220px;padding:5px 10px;border-radius:10px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(148,163,184,.35));color:var(--dsw-alias-label-primary,#111);font-size:12px;line-height:1.35;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.12)}',
      '.dpo-guest-name{margin-top:4px;padding:1px 8px;border-radius:9px;background:rgba(15,23,42,.45);color:#e2e8f0;font-size:11px;white-space:nowrap}',
      '.dpo-guest.dpo-sleeping{opacity:.55}',
      '.dpo-guest-zzz{font-size:12px;color:#94a3b8}',
      '.dpo-chat-line{padding:3px 0;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary,#e2e8f0)}',
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

    function Panel() {
      const { snap, error } = useSnapshot()
      const [code, setCode] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [toasts, setToasts] = useState([])
      const [accept, setAccept] = useState(true)
      const [share, setShare] = useState(true)
      const [acceptChat, setAcceptChat] = useState(true)

      useEffect(() => {
        if (!snap || !snap.config) return
        setAccept(snap.config.acceptInteractions !== false)
        setShare(snap.config.shareBubbles !== false)
        setAcceptChat(snap.config.acceptChat !== false)
      }, [snap && snap.config && snap.config.acceptInteractions, snap && snap.config && snap.config.shareBubbles, snap && snap.config && snap.config.acceptChat])

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

      const interact = (peer, intent, note) =>
        run(
          () => getJson('/interact', { method: 'POST', body: JSON.stringify({ to: peer.deviceId, intent, note }) }),
          '已向 ' + peer.name + ' 发起交互',
        )

      const leaveNote = (peer) => {
        const note = window.prompt('给 ' + peer.name + ' 留句话（40 字以内）', '')
        if (note === null) return
        const trimmed = note.trim().slice(0, 40)
        if (trimmed === '') return
        interact(peer, 'visit-note', trimmed)
      }

      const chatWith = (peer) => {
        const text = window.prompt('跟 ' + peer.name + ' 的宠物说句话（它会用自己的 LLM 人设回你）', '')
        if (text === null) return
        const trimmed = text.trim().slice(0, 500)
        if (trimmed === '') return
        run(
          () => getJson('/chat', { method: 'POST', body: JSON.stringify({ to: peer.deviceId, text: trimmed }) }),
          '消息已发出，等对方回话',
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
        ),
        h(
          'div',
          { className: 'dpo-card' },
          h('div', { className: 'dpo-title' }, '在线设备（' + peers.length + '）'),
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
                    h('div', { className: 'dpo-peer-meta' }, peer.pet || '未知宠物'),
                  ),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'wave') }, '打招呼'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'treat') }, '投喂'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'poke') }, '戳一下'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => interact(peer, 'hug') }, '抱抱'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => leaveNote(peer) }, '留言'),
                  h('button', { className: 'dpo-btn', disabled: busy, onClick: () => chatWith(peer) }, '聊天'),
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
                          h('b', null, m.from === 'me' ? '我：' : peer.name + '：'),
                          m.text,
                        ),
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
          h('div', { className: 'dpo-muted', style: { marginTop: 8 } }, '联机数据只含宠物名、大小、动作与气泡；不含对话记忆、文件或账号信息。'),
        ),
        toasts.length > 0
          ? h('div', { className: 'dpo-toast' }, toasts.map((t) => h('div', { className: 'dpo-toast-item', key: t.id }, t.text)))
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

    /** 一段远端动画：blob 加载后交给 <video>，素材来自本机 dsh-pet 的同名 webm。 */
    function RemoteClip(props) {
      const { assetRoot, anim, width } = props
      const videoRef = React.useRef(null)
      const [ready, setReady] = useState(false)
      useEffect(() => {
        let alive = true
        let objectUrl = null
        const controller = new AbortController()
        const load = async () => {
          setReady(false)
          for (const ext of ['webm', 'mov']) {
            try {
              const url =
                '/dsh-pet-7340/thumb/' +
                encodeURIComponent(assetRoot || 'main') +
                '/' +
                encodeURIComponent(anim) +
                '.' +
                ext
              const res = await fetch(url, { cache: 'default', signal: controller.signal })
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
              /* try next ext */
            }
          }
        }
        if (anim) load()
        return () => {
          alive = false
          controller.abort()
          if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
      }, [assetRoot, anim])
      return h('video', {
        ref: videoRef,
        width,
        height: Math.round((width * 9) / 16),
        muted: true,
        autoPlay: true,
        loop: true,
        playsInline: true,
        style: { opacity: ready ? 1 : 0, transition: 'opacity .2s ease' },
      })
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
      const { peer, pet, index, bodies } = props
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
          title: peer.name + ' 的宠物（可拖动抛掷，点一下戳它）',
          onPointerDown: onDown,
          onPointerMove: onMove,
          onPointerUp: onUp,
          onPointerCancel: onUp,
        },
        pet.bubble ? h('div', { className: 'dpo-guest-bubble' }, pet.bubble) : null,
        pet.sleeping ? h('div', { className: 'dpo-guest-zzz' }, '💤') : null,
        h(RemoteClip, { assetRoot: pet.assetRoot, anim: pet.anim, width }),
        h('div', { className: 'dpo-guest-name' }, peer.name),
      )
    }

    function GuestLayer() {
      const snap = useOverlay()
      const bodies = useGuestBodies()
      if (!snap || !Array.isArray(snap.peers)) return null
      const sprites = []
      let index = 0
      for (const peer of snap.peers) {
        if (peer.online === false) continue
        for (const pet of Array.isArray(peer.pets) ? peer.pets : []) {
          sprites.push(h(GuestPet, { key: peer.deviceId + ':' + pet.id, peer, pet, index, bodies }))
          index += 1
        }
      }
      return sprites.length > 0 ? h('div', { className: 'dpo-guest-layer' }, sprites) : null
    }

    return {
      inject: ['slots'],
      apply(ctx) {
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
