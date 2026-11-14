/**
 * 更新检测：拿 GitHub Release 的最新 tag 和本机版本比。
 *
 * 只读公开接口，不下载、不安装；失败只记录原因，不打扰使用。
 */

const RELEASE_API = 'https://api.github.com/repos/{repo}/releases/latest'

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
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchImpl(RELEASE_API.replace('{repo}', repo), {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-pet-online' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const body = await res.json()
        const latest = normalizeVersion(body?.tag_name)
        if (latest === '') throw new Error('empty tag')
        state = {
          ...state,
          latest,
          hasUpdate: compareVersions(latest, state.current) > 0,
          url: typeof body?.html_url === 'string' ? body.html_url : '',
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
        clearTimeout(timer)
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
