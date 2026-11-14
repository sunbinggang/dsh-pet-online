import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

/** 在 vm 里加载浏览器半侧，验证模块契约与 apply 注册行为（不需要真实 DOM/React）。 */
async function loadClient() {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  let module = null
  const registered = []
  const styleTags = []

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          const requireStub = (name) => {
            if (name === 'react') {
              return {
                createElement: () => null,
                useEffect: () => {},
                useState: (initial) => [initial, () => {}],
                useRef: (initial) => ({ current: initial }),
                Fragment: 'fragment',
              }
            }
            throw new Error('unexpected require: ' + name)
          }
          module = { id, exports: factory(requireStub) }
        },
      },
    },
    document: {
      createElement: () => {
        const tag = { setAttribute() {}, textContent: '', parentNode: null }
        styleTags.push(tag)
        return tag
      },
      head: {
        appendChild(tag) {
          tag.parentNode = { removeChild() {} }
        },
      },
      querySelector: () => null,
      visibilityState: 'visible',
    },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, peers: [] }) }),
    URL,
    AbortController,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  return {
    module,
    styleTags,
    registered,
    makeCtx() {
      return {
        effect(fn) {
          return fn?.() ?? (() => {})
        },
        slots: {
          inject(_slot, fn) {
            return fn()
          },
          register(options) {
            registered.push(options)
            return () => {}
          },
        },
      }
    },
  }
}

test('浏览器半侧：模块契约与两个插槽注册', async () => {
  const loaded = await loadClient()
  assert.ok(loaded.module)
  assert.equal(loaded.module.id, 'dsh-pet-online')
  const plugin = loaded.module.exports
  assert.equal(plugin.inject.join(','), 'slots')
  assert.equal(typeof plugin.apply, 'function')

  plugin.apply(loaded.makeCtx())
  assert.equal(
    loaded.registered.map((r) => r.name).sort().join(','),
    'settings.section,shell.overlay',
  )
  const section = loaded.registered.find((r) => r.name === 'settings.section')
  assert.equal(section.id, 'dsh-pet-online')
  assert.equal(typeof section.label, 'function')
  assert.equal(section.label(), '桌宠联机')

  // 样式只注入一次，且插件卸载时应能移除
  assert.equal(loaded.styleTags.length, 1)

  // 回归：覆盖层是 pointer-events:none，菜单/遮罩必须显式恢复 auto，否则菜单点不动。
  const css = loaded.styleTags[0].textContent
  for (const selector of ['.dpo-menu{', '.dpo-menu-item{', '.dpo-menu-backdrop{']) {
    const start = css.indexOf(selector)
    assert.ok(start >= 0, 'missing ' + selector)
    const end = css.indexOf('}', start)
    assert.match(css.slice(start, end), /pointer-events:auto/, selector + ' needs pointer-events:auto')
  }

  // 回归：访客气泡必须自带白底深字，不能继承主题的页面底色（深色主题下会和背景融为一体，只剩文字）。
  const bubbleStart = css.indexOf('.dpo-guest-bubble{')
  assert.ok(bubbleStart >= 0, 'missing .dpo-guest-bubble')
  const bubbleRule = css.slice(bubbleStart, css.indexOf('}', bubbleStart))
  assert.match(bubbleRule, /background:#fff/, 'guest bubble needs an explicit white background')
  assert.match(bubbleRule, /color:#1f2937/, 'guest bubble needs an explicit dark text color')
  assert.doesNotMatch(bubbleRule, /--dsw-alias-bg-base/, 'guest bubble must not inherit the page background')

  // 回归：联机气泡要像原生碎碎念一样带配图，图片样式与 bubbleImage 渲染都要在。
  assert.match(css, /\.dpo-guest-bubble-img\{/, 'missing guest bubble image style')
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /bubbleImage/, 'guest bubble must render the peer bubble image')
  assert.match(source, /\/dsh-pet-7340\/pic\/memes\//, 'bubble image must come from dsh-pet meme route')
})

test('浏览器半侧：留言/聊天用自带输入框，不依赖 window.prompt', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // DSH 桌面壳（Electron）禁用了 window.prompt，用它会导致「点了没反应」。
  assert.doesNotMatch(source, /window\.prompt\s*\(/, 'must not use window.prompt')
  assert.match(source, /dpo-compose/)
  assert.match(source, /submitCompose/)
})

test('浏览器半侧：播放同一首要保住用户手势，不能只发请求等轮询', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 回归：只 POST /music/play 的话，真正的 audio.play() 发生在轮询回调里，会被浏览器自动播放策略拦下。
  assert.match(source, /playMusicShare\s*=\s*\(item\)/, 'play button must pass the full share item')
  assert.match(source, /playSharedFromGesture\(item\.track/, 'play button must start playback inside the click gesture')
  assert.match(source, /function unlockSharedAudio\(\)/, 'need a gesture-time audio unlock')
  assert.match(source, /armMusicUnlockRetry/, 'blocked autoplay needs a pointerdown retry')
})
