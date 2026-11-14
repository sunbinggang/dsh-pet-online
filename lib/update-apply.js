/**
 * 一键更新：下载 GitHub Release 的 .tgz，解包后覆盖本包目录。
 *
 * 安全性：
 *  - 只接受比当前版本更新的 release；
 *  - tar 条目拒绝绝对路径 / `..`，解包总大小有上限；
 *  - 覆盖前把当前目录整体备份到 $DSH_HOME/dsh-pet-online/backups/。
 *
 * 更新完成后需要重启 DSH 才会加载新代码（宿主插件只在启动时装配）。
 */

import { gunzipSync } from 'node:zlib'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'
import { compareVersions, fetchLatestRelease, normalizeVersion } from './update.js'

const MAX_TAR_BYTES = 40 * 1024 * 1024
const UA = { 'user-agent': 'dsh-pet-online' }

/** 解析 tar 的八进制/长度字段。 */
function readOctal(buffer, start, length) {
  const slice = buffer.subarray(start, start + length).toString('ascii').replace(/\0.*$/, '').trim()
  return slice === '' ? 0 : Number.parseInt(slice, 8) || 0
}

function readString(buffer, start, length) {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim()
}

/**
 * 解析 tar 缓冲，返回 {name,type,data} 列表（type: file/dir）。
 * @param {Buffer} buffer
 */
export function parseTar(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const fullName = prefix === '' ? name : prefix + '/' + name
    const size = readOctal(header, 124, 12)
    const typeflag = String.fromCharCode(header[156] || 0)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) throw new Error('tar truncated: ' + fullName)
    const type = typeflag === '5' ? 'dir' : typeflag === '' || typeflag === '0' ? 'file' : 'other'
    entries.push({
      name: fullName,
      type,
      data: type === 'file' ? buffer.subarray(dataStart, dataEnd) : Buffer.alloc(0),
    })
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

/** 拒绝绝对路径与目录穿越，返回以 / 分隔的相对路径。 */
export function safeEntryPath(name) {
  const normalized = normalize(String(name)).replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('unsafe path: ' + name)
  const parts = normalized.split('/')
  if (parts.includes('..')) throw new Error('unsafe path: ' + name)
  return parts.filter((part) => part !== '' && part !== '.').join('/')
}

/** 解压 npm pack 产出的 tgz 到 destDir，返回解出的文件数。 */
export async function extractTgz(gzipBuffer, destDir) {
  let total = 0
  for (const entry of parseTar(gunzipSync(gzipBuffer))) {
    if (entry.type === 'other') continue
    const relative = safeEntryPath(entry.name)
    if (relative === '') continue
    const target = join(destDir, relative)
    if (entry.type === 'dir') {
      await mkdir(target, { recursive: true })
      continue
    }
    total += entry.data.length
    if (total > MAX_TAR_BYTES) throw new Error('tarball too large')
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, entry.data)
  }
  return total
}

/** 在解包目录里找包根（npm pack 外层固定是 package/）。 */
async function findPackageRoot(dir) {
  const direct = join(dir, 'package')
  try {
    const info = await stat(join(direct, 'package.json'))
    if (info.isFile()) return direct
  } catch {
    /* fall through */
  }
  const names = await readdir(dir)
  for (const name of names) {
    const candidate = join(dir, name)
    try {
      const info = await stat(join(candidate, 'package.json'))
      if (info.isFile()) return candidate
    } catch {
      /* keep scanning */
    }
  }
  throw new Error('package.json not found in tarball')
}

/**
 * 执行一次更新。
 * @param {object} opts
 * @param {string} opts.currentVersion
 * @param {string} opts.repo
 * @param {string} opts.rootDir 当前包目录（覆盖目标）
 * @param {string} opts.backupRoot 备份父目录
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<{ok:boolean, updatedTo?:string, backup?:string, restartRequired?:boolean, reason?:string}>}
 */
export async function applyUpdate(opts) {
  const { currentVersion, repo, rootDir, backupRoot, fetchImpl = globalThis.fetch } = opts
  try {
    let pkgName = 'dsh-pet-online'
    try {
      const local = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'))
      if (typeof local?.name === 'string' && local.name !== '') pkgName = local.name
    } catch {
      /* 根目录不可读时用包名默认值 */
    }

    let release
    try {
      release = await fetchLatestRelease({ repo, fetchImpl })
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    const latest = normalizeVersion(release.tag)
    if (latest === '') return { ok: false, reason: 'empty tag' }
    if (compareVersions(latest, currentVersion) <= 0) {
      return { ok: false, reason: 'already-latest', updatedTo: latest }
    }

    // tag 可能带 v 也可能不带。国内网络直连 github.com 的 release 资产常被
    // ECONNRESET（等几十秒才失败），所以先用 API 资产端点（Accept:
    // application/octet-stream）拿，直链只作最后的兜底。
    const rawTag = String(release.tag)
    const tags = [rawTag]
    const altTag = normalizeVersion(rawTag) === rawTag ? 'v' + rawTag : normalizeVersion(rawTag)
    if (altTag !== rawTag) tags.push(altTag)

    let gzip = null
    let lastDownloadError = ''
    let apiListed = false
    let assetFound = false

    for (const tag of tags) {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
          headers: { ...UA, accept: 'application/vnd.github+json' },
        })
        if (!res.ok) {
          lastDownloadError += '; assets HTTP ' + res.status
          continue
        }
        apiListed = true
        const body = await res.json()
        const asset = Array.isArray(body?.assets)
          ? body.assets.find((item) => typeof item?.name === 'string' && /\.tgz$/.test(item.name))
          : undefined
        if (!asset) continue
        assetFound = true
        const assetUrls = []
        if (typeof asset.url === 'string' && asset.url !== '') assetUrls.push(asset.url)
        if (typeof asset.browser_download_url === 'string') assetUrls.push(asset.browser_download_url)
        for (const assetUrl of assetUrls) {
          try {
            const download = await fetchImpl(assetUrl, { headers: { ...UA, accept: 'application/octet-stream' } })
            if (!download.ok) {
              lastDownloadError += '; asset HTTP ' + download.status
              continue
            }
            gzip = Buffer.from(await download.arrayBuffer())
            break
          } catch (error) {
            lastDownloadError += '; ' + (error instanceof Error ? error.message : String(error))
          }
        }
        if (gzip !== null) break
      } catch (error) {
        lastDownloadError += '; ' + (error instanceof Error ? error.message : String(error))
      }
    }

    if (gzip === null) {
      const downloadUrls = tags.map((tag) => ({
        url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${pkgName}-${latest}.tgz`,
        headers: UA,
      }))
      for (const candidate of downloadUrls) {
        try {
          const download = await fetchImpl(candidate.url, { headers: candidate.headers })
          if (!download.ok) {
            lastDownloadError = 'download HTTP ' + download.status
            continue
          }
          gzip = Buffer.from(await download.arrayBuffer())
          break
        } catch (error) {
          lastDownloadError = error instanceof Error ? error.message : String(error)
        }
      }
    }

    if (gzip === null) {
      if (apiListed && !assetFound) return { ok: false, reason: 'no-tgz-asset' }
      return { ok: false, reason: lastDownloadError || 'download failed' }
    }
    if (gzip.length > MAX_TAR_BYTES) return { ok: false, reason: 'tarball too large' }

    const staging = await mkdtemp(join(tmpdir(), 'dsh-pet-online-update-'))
    try {
      await extractTgz(gzip, staging)
      const packageRoot = await findPackageRoot(staging)
      const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
      if (normalizeVersion(pkg.version) !== latest) {
        return { ok: false, reason: 'version-mismatch: ' + String(pkg.version) }
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const backup = join(backupRoot, 'backup-' + currentVersion + '-' + stamp)
      await mkdir(backupRoot, { recursive: true })
      await cp(rootDir, backup, { recursive: true, force: true })
      await cp(packageRoot, rootDir, { recursive: true, force: true })

      return { ok: true, updatedTo: latest, backup, restartRequired: true }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
