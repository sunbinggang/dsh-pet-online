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

test('浏览器半侧：房间切歌交给 dsh-music-player，而不是再挂一个 audio', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // dsh-music-player 没有 /intent 的写接口，只能在页面里拦截它的轮询并回一份播放意图。
  assert.match(source, /syncViaMusicPlayer/, 'need a music-player sync path')
  assert.match(source, /musicIntentOverride/, 'need an intent override')
  assert.ok(source.includes('dsh-music\\/intent'), 'must intercept the music player intent poll')
  assert.match(source, /new Response\(JSON\.stringify\(intent\)/, 'intent poll must answer with JSON')
  assert.match(source, /resolveMusicIntent/, 'need to map a shared track to a music-player intent')
  assert.match(source, /syncMusicNow/, 'panel needs a manual sync button')
})

test('浏览器半侧：共享音乐用页面内最新 prefs 快照，播放条可隐藏', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 播放器写宿主 prefs 有 800ms 防抖，刚切歌时宿主快照还是旧的：共享必须优先用页面内截获的值。
  assert.match(source, /readTrackFromPrefs/, 'need to read a track out of player prefs')
  assert.match(source, /mergeMusicPrefs/, 'need to keep a fresh prefs snapshot')
  assert.match(source, /currentMusicTrack/, 'share must ask for the freshest current track')
  assert.match(source, /\/dsh-music\/prefs/, 'must observe the music player prefs endpoint')
  // 电台只有 station 对象：识别成正在播放，并把流地址带给对端。
  assert.match(source, /kind: 'radio'/, 'radio needs a music-player intent')
  assert.match(source, /radioUrl/)
  // 右下角播放条可关闭，下一首共享时重新出现；面板能再打开。
  assert.match(source, /dpo-share-music-close/, 'share bar needs a close button')
  assert.match(source, /sharedSet\(\{ hidden: true \}\)/)
  assert.match(source, /显示共享播放条/)
})

test('浏览器半侧：播放器自动连播下一首时由页面主动上报切歌', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  // 宿主每 2.5s 读的是防抖后的 prefs 快照；页面在 prefs 写入时就能知道换了歌，主动推给房间。
  assert.match(source, /scheduleAutoMusicSync/, 'auto-play next must be reported from the page')
  assert.match(source, /trackKeyOf/, 'need a stable key to detect a track change')
  assert.match(source, /auto: true/, 'auto sync must be marked so it respects the toggle')
  // 手动「同步当前播放」也要带上页面里的曲目，别等宿主快照。
  assert.match(source, /JSON\.stringify\(\{ track \}\)/, 'manual sync must send the track from the page')
})
