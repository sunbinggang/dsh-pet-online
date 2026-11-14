import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { applyUpdate, extractTgz, parseTar, safeEntryPath } from '../lib/update-apply.js'

function header(name, size) {
  const block = Buffer.alloc(512)
  block.write(name, 0, 100, 'utf8')
  block.write('0000644', 100, 8, 'ascii')
  block.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  block.write('0', 156, 1, 'ascii')
  return block
}

function makeTar(entries) {
  const parts = []
  for (const { name, content, type } of entries) {
    const data = Buffer.from(content ?? '', 'utf8')
    const block = header(name, data.length)
    if (type === 'dir') block[156] = '5'.charCodeAt(0)
    parts.push(block)
    if (type !== 'dir') {
      parts.push(data)
      const pad = (512 - (data.length % 512)) % 512
      if (pad > 0) parts.push(Buffer.alloc(pad))
    }
  }
  parts.push(Buffer.alloc(1024))
  return Buffer.concat(parts)
}

test('tar 解析与路径安全', () => {
  const tar = makeTar([
    { name: 'package/package.json', content: '{"name":"x"}' },
    { name: 'package/lib/', type: 'dir' },
  ])
  const entries = parseTar(tar)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'package/package.json')
  assert.equal(entries[1].type, 'dir')

  assert.throws(() => safeEntryPath('../evil'), /unsafe path/)
  assert.throws(() => safeEntryPath('/etc/passwd'), /unsafe path/)
  assert.throws(() => safeEntryPath('C:\\Windows\\x'), /unsafe path/)
  assert.equal(safeEntryPath('package/lib/a.js'), 'package/lib/a.js')
})

test('tgz 解包到临时目录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dpo-tgz-'))
  const gz = gzipSync(makeTar([{ name: 'package/hello.txt', content: 'hi' }]))
  await extractTgz(gz, dir)
  assert.equal(await readFile(join(dir, 'package/hello.txt'), 'utf8'), 'hi')
})

test('一键更新：已是最新时拒绝；无 tgz 资产时拒绝', async () => {
  const html = (tag) => ({
    status: 302,
    ok: false,
    headers: { get: () => `https://github.com/owner/repo/releases/tag/${tag}` },
  })

  const already = await applyUpdate({
    currentVersion: '0.6.0',
    repo: 'owner/repo',
    rootDir: '/tmp/never',
    backupRoot: '/tmp/never-backup',
    fetchImpl: async () => html('v0.6.0'),
  })
  assert.equal(already.ok, false)
  assert.equal(already.reason, 'already-latest')

  const calls = []
  const noAsset = await applyUpdate({
    currentVersion: '0.5.0',
    repo: 'owner/repo',
    rootDir: '/tmp/never',
    backupRoot: '/tmp/never-backup',
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('/releases/latest')) return html('v0.6.0')
      if (url.includes('/releases/download/')) return { ok: false, status: 404 }
      if (url.includes('/releases/tags/')) return { ok: true, json: async () => ({ tag_name: 'v0.6.0', assets: [] }) }
      throw new Error('unexpected ' + url)
    },
  })
  assert.equal(noAsset.ok, false)
  assert.equal(noAsset.reason, 'no-tgz-asset')
  assert.ok(calls.some((url) => url.includes('/releases/download/v0.6.0/')))
})

test('一键更新：直链被重置时回退 API 资产端点下载', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'dpo-root-'))
  const backupRoot = await mkdtemp(join(tmpdir(), 'dpo-backup-'))
  const gz = gzipSync(
    makeTar([
      { name: 'package/package.json', content: '{"name":"dsh-pet-online","version":"0.6.0"}' },
      { name: 'package/lib/service.js', content: 'export {}' },
    ]),
  )
  const calls = []
  const result = await applyUpdate({
    currentVersion: '0.5.0',
    repo: 'owner/repo',
    rootDir,
    backupRoot,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('/releases/latest')) {
        return {
          status: 302,
          ok: false,
          headers: { get: () => 'https://github.com/owner/repo/releases/tag/v0.6.0' },
        }
      }
      if (url.includes('/releases/download/')) throw new Error('fetch failed')
      if (url.includes('/releases/tags/')) {
        return {
          ok: true,
          json: async () => ({
            tag_name: 'v0.6.0',
            assets: [
              {
                name: 'dsh-pet-online-0.6.0.tgz',
                url: 'https://api.github.com/repos/owner/repo/releases/assets/42',
                browser_download_url: 'https://github.com/owner/repo/releases/download/v0.6.0/dsh-pet-online-0.6.0.tgz',
              },
            ],
          }),
        }
      }
      if (url.endsWith('/releases/assets/42')) {
        return { ok: true, arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) }
      }
      throw new Error('unexpected ' + url)
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.updatedTo, '0.6.0')
  assert.equal(result.restartRequired, true)
  assert.ok(calls.some((url) => url.endsWith('/releases/assets/42')))
  assert.equal(await readFile(join(rootDir, 'package.json'), 'utf8'), '{"name":"dsh-pet-online","version":"0.6.0"}')
  assert.ok((await stat(join(rootDir, 'lib/service.js'))).isFile())
  assert.ok((await stat(result.backup)).isDirectory())
})
