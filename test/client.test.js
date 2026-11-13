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
})
