import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
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
  const calls = []
  const already = await applyUpdate({
    currentVersion: '0.6.0',
    repo: 'owner/repo',
    rootDir: '/tmp/never',
    backupRoot: '/tmp/never-backup',
    fetchImpl: async (url) => {
      calls.push(url)
      return { ok: true, json: async () => ({ tag_name: 'v0.6.0', assets: [] }) }
    },
  })
  assert.equal(already.ok, false)
  assert.equal(already.reason, 'already-latest')

  const noAsset = await applyUpdate({
    currentVersion: '0.5.0',
    repo: 'owner/repo',
    rootDir: '/tmp/never',
    backupRoot: '/tmp/never-backup',
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v0.6.0', assets: [] }) }),
  })
  assert.equal(noAsset.ok, false)
  assert.equal(noAsset.reason, 'no-tgz-asset')
  assert.ok(calls.length > 0)
})
