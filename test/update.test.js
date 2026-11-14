import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, createUpdateChecker, normalizeVersion } from '../lib/update.js'

test('版本比较', () => {
  assert.equal(compareVersions('0.4.3', '0.4.3'), 0)
  assert.equal(compareVersions('0.5.0', '0.4.3'), 1)
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1)
  assert.equal(compareVersions('v0.4.3', '0.4.3'), 0)
  assert.equal(compareVersions('0.4.3', '0.4.3-beta'), 1)
  assert.equal(compareVersions('0.4.3-beta', '0.4.3'), -1)
  assert.equal(normalizeVersion('v1.2.3'), '1.2.3')
})

test('更新检查：发现新版本', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.3',
    repo: 'owner/repo',
    fetchImpl: async (url) => {
      assert.match(url, /repos\/owner\/repo\/releases\/latest/)
      return {
        ok: true,
        json: async () => ({ tag_name: 'v0.5.0', html_url: 'https://example.com/release' }),
      }
    },
  })
  await checker.check()
  assert.equal(checker.state.latest, '0.5.0')
  assert.equal(checker.state.hasUpdate, true)
  assert.equal(checker.state.url, 'https://example.com/release')
  assert.equal(checker.state.error, '')
})

test('更新检查：已是最新 / 网络失败', async () => {
  const same = createUpdateChecker({
    currentVersion: '0.5.0',
    repo: 'owner/repo',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.5.0', html_url: 'u' }) }),
  })
  await same.check()
  assert.equal(same.state.hasUpdate, false)

  const broken = createUpdateChecker({
    currentVersion: '0.4.3',
    repo: 'owner/repo',
    fetchImpl: async () => {
      throw new Error('offline')
    },
  })
  await broken.check()
  assert.equal(broken.state.hasUpdate, false)
  assert.equal(broken.state.error, 'offline')
})
