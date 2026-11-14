import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareVersions,
  createUpdateChecker,
  fetchLatestRelease,
  normalizeVersion,
  parseTagFromAtom,
  parseTagFromLocation,
} from '../lib/update.js'

test('版本比较', () => {
  assert.equal(compareVersions('0.4.3', '0.4.3'), 0)
  assert.equal(compareVersions('0.5.0', '0.4.3'), 1)
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1)
  assert.equal(compareVersions('v0.4.3', '0.4.3'), 0)
  assert.equal(compareVersions('0.4.3', '0.4.3-beta'), 1)
  assert.equal(compareVersions('0.4.3-beta', '0.4.3'), -1)
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3')
})

test('tag 解析：Location 与 atom', () => {
  assert.equal(parseTagFromLocation('https://github.com/o/r/releases/tag/v0.8.0'), 'v0.8.0')
  assert.equal(parseTagFromLocation('https://github.com/o/r/releases/tag/v0.8.0?x=1'), 'v0.8.0')
  assert.equal(parseTagFromLocation(''), '')
  assert.equal(parseTagFromAtom('<feed><entry><link href="https://github.com/o/r/releases/tag/v0.8.0"/></entry></feed>'), 'v0.8.0')
})

test('更新检查：HTML 302 拿 tag（不受 API 限流影响）', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.3',
    repo: 'owner/repo',
    fetchImpl: async (url) => {
      assert.match(url, /github\.com\/owner\/repo\/releases\/latest/)
      return {
        status: 302,
        ok: false,
        headers: { get: (name) => (name === 'location' ? 'https://github.com/owner/repo/releases/tag/v0.5.0' : null) },
      }
    },
  })
  await checker.check()
  assert.equal(checker.state.latest, '0.5.0')
  assert.equal(checker.state.hasUpdate, true)
  assert.equal(checker.state.url, 'https://github.com/owner/repo/releases/tag/v0.5.0')
  assert.equal(checker.state.error, '')
})

test('更新检查：HTML/atom 失败后回退 API', async () => {
  const urls = []
  const release = await fetchLatestRelease({
    repo: 'owner/repo',
    fetchImpl: async (url) => {
      urls.push(url)
      if (url.includes('github.com') && !url.includes('api.github.com')) {
        throw new Error('fetch failed')
      }
      return { ok: true, json: async () => ({ tag_name: 'v0.6.0' }) }
    },
  })
  assert.equal(release.tag, '0.6.0')
  assert.equal(release.source, 'api')
  assert.ok(urls.some((url) => url.includes('releases.atom')))
  assert.ok(urls.some((url) => url.includes('api.github.com')))
})

test('更新检查：全部通道 403 时报错', async () => {
  const broken = createUpdateChecker({
    currentVersion: '0.4.3',
    repo: 'owner/repo',
    fetchImpl: async () => ({ ok: false, status: 403, headers: { get: () => null } }),
  })
  await broken.check()
  assert.equal(broken.state.hasUpdate, false)
  assert.match(broken.state.error, /403/)
})

test('更新检查：同类请求并发去重', async () => {
  let calls = 0
  const checker = createUpdateChecker({
    currentVersion: '0.5.0',
    repo: 'owner/repo',
    fetchImpl: async () => {
      calls += 1
      return {
        status: 302,
        ok: false,
        headers: { get: () => 'https://github.com/owner/repo/releases/tag/v0.5.0' },
      }
    },
  })
  await Promise.all([checker.check(), checker.check()])
  assert.equal(calls, 1)
  assert.equal(checker.state.hasUpdate, false)
})
