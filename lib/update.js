/**
 * 更新检测：拿 GitHub Release 的最新 tag 和本机版本比。
 *
 * 只读公开接口，不下载、不安装；失败只记录原因，不打扰使用。
 */

const RELEASE_API = 'https://api.github.com/repos/{repo}/releases/latest'
const RELEASE_HTML = 'https://github.com/{repo}/releases/latest'
const RELEASE_ATOM = 'https://github.com/{repo}/releases.atom'
const UA = { 'user-agent': 'dsh-pet-online' }

/** 从 GitHub 302 的 Location 里取 tag，如 .../releases/tag/v0.8.0 → v0.8.0。 */
export function parseTagFromLocation(location) {
  const match = /\/releases\/tag\/([^/?#]+)/.exec(String(location ?? ''))
  return match ? decodeURIComponent(match[1]) : ''
}

/** 从 releases.atom 里取最新一条 tag。 */
export function parseTagFromAtom(text) {
  const match = /\/releases\/tag\/([^"'<>\s]+)/.exec(String(text ?? ''))
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * 查最新 Release 的 tag。
 *
 * api.github.com 对未登录请求限流（共享出口 IP 很容易 403），所以优先用
 * github.com 的 HTML 跳转 / atom 订阅，API 只作最后兜底。
 *
 * @returns {Promise<{tag:string, url:string, source:string}>}
 */
export async function fetchLatestRelease({ repo, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!repo || typeof fetchImpl !== 'function') throw new Error('no repo')
  const errors = []
  const attempt = async (label, url, read) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(url, { ...initFor(label), signal: controller.signal })
      const tag = await read(res)
      if (tag) return tag
      errors.push(label + ': empty tag')
    } catch (error) {
      errors.push(label + ': ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      clearTimeout(timer)
    }
    return ''
  }

  const initFor = (label) => {
    if (label === 'html') return { redirect: 'manual', headers: UA }
    if (label === 'api') return { headers: { ...UA, accept: 'application/vnd.github+json' } }
    return { headers: UA }
  }

  let tag = await attempt('html', RELEASE_HTML.replace('{repo}', repo), (res) =>
    parseTagFromLocation(res?.headers?.get?.('location')),
  )
  if (tag) return { tag, url: `https://github.com/${repo}/releases/tag/${tag}`, source: 'html' }

  tag = await attempt('atom', RELEASE_ATOM.replace('{repo}', repo), async (res) =>
    res?.ok === false ? '' : parseTagFromAtom(await res.text()),
  )
  if (tag) return { tag, url: `https://github.com/${repo}/releases/tag/${tag}`, source: 'atom' }

  // 关键：API 的 tag_name 原样返回（通常带 v 前缀）。早先这里 normalize 掉了 v，
  // 下载地址就变成 /releases/download/0.8.4/...，GitHub 直接 404，一键更新必失败。
  tag = await attempt('api', RELEASE_API.replace('{repo}', repo), async (res) => {
    if (res?.ok === false) {
      throw new Error('HTTP ' + res.status)
    }
    const body = await res.json()
    return String(body?.tag_name ?? '').trim()
  })
  if (tag) {
    return {
      tag,
      url: `https://github.com/${repo}/releases/tag/${tag}`,
      source: 'api',
    }
  }

  throw new Error(errors.join('; ') || 'release lookup failed')
}

/** 纯数字段比较（忽略 pre-release 细节：0.4.3 > 0.4.3-beta）。 */
export function compareVersions(a, b) {
  const parse = (value) => {
    const [main, pre] = String(value ?? '')
      .replace(/^v/i, '')
      .split('-')
    const nums = main.split('.').map((n) => Number.parseInt(n, 10) || 0)
    return { nums, pre: pre ?? '' }
  }
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.nums.length, right.nums.length)
  for (let i = 0; i < len; i += 1) {
    const x = left.nums[i] ?? 0
    const y = right.nums[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre > right.pre ? 1 : -1
}

export function normalizeVersion(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^v/i, '')
}

/**
 * 创建一个更新检查器。
 * @param {object} opts
 * @param {string} opts.currentVersion 本机版本
 * @param {string} opts.repo GitHub owner/repo
 * @param {Function} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 */
export function createUpdateChecker(opts) {
  const { currentVersion, repo, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = opts
  let state = {
    current: normalizeVersion(currentVersion),
    latest: '',
    hasUpdate: false,
    url: '',
    checkedAt: 0,
    error: '',
  }
  let inflight = null

  async function check() {
    if (!repo || typeof fetchImpl !== 'function') return state
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const release = await fetchLatestRelease({ repo, fetchImpl, timeoutMs })
        const latest = normalizeVersion(release.tag)
        state = {
          ...state,
          latest,
          hasUpdate: compareVersions(latest, state.current) > 0,
          url: release.url,
          checkedAt: Date.now(),
          error: '',
        }
      } catch (error) {
        state = {
          ...state,
          checkedAt: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        inflight = null
      }
      return state
    })()
    return inflight
  }

  return {
    check,
    get state() {
      return state
    },
  }
}
