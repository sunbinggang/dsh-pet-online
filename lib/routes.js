/**
 * 插件自己的 HTTP 路由（面板 API）。
 *
 * 只服务本机回环：DSH webServer 默认只监听 127.0.0.1，这里再做一次 Host/Origin
 * 同源校验，避免其它本地端口上的页面驱动配对/互动。
 */

import { ROUTE_SEGMENT } from './protocol.js'

const MAX_BODY = 64 * 1024

function writeJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function isLoopbackHost(hostname) {
  const h = String(hostname).toLowerCase()
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127\./.test(h)
}

function fromLoopback(req) {
  const address = req.socket?.remoteAddress
  if (typeof address !== 'string') return false
  const loopback = address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
  if (!loopback) return false
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  if (!isLoopbackHost(hostUrl.hostname)) return false
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers?.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      const originUrl = new URL(origin)
      if (!isLoopbackHost(originUrl.hostname) || originUrl.port !== hostUrl.port) return false
    } catch {
      return false
    }
  }
  return true
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        done(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return done({})
      try {
        const parsed = JSON.parse(raw)
        done(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null)
      } catch {
        done(null)
      }
    })
    req.on('error', () => done(null))
  })
}

/**
 * 创建路由处理器。
 * @param {object} service - createOnlineService 的返回值
 */
export function createRouter(service) {
  return async function handle(req, res) {
    if (!fromLoopback(req)) {
      writeJson(res, 403, { ok: false, reason: 'forbidden', message: 'loopback only' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://dsh-pet-online.local')
    const rest = decodeURIComponent(url.pathname.slice(ROUTE_SEGMENT.length + 1))
    const method = req.method ?? 'GET'

    try {
      if (rest === 'ping') {
        if (method !== 'GET') return writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
        return writeJson(res, 200, { ok: true, name: 'dsh-pet-online', version: 1 })
      }
      if (rest === 'state') {
        if (method !== 'GET') return writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
        return writeJson(res, 200, service.snapshot())
      }
      if (rest === 'events') {
        if (method !== 'GET') return writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
        const since = Number(url.searchParams.get('since') ?? '0')
        const timeout = Number(url.searchParams.get('timeout') ?? '10000')
        const result = await service.waitForChange(Number.isFinite(since) ? since : 0, Number.isFinite(timeout) ? timeout : 10_000)
        return writeJson(res, 200, result)
      }
      if (rest === 'music/now') {
        if (method !== 'GET') return writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })
        const result = await service.musicNow()
        return writeJson(res, result.ok ? 200 : 404, result)
      }
      if (method !== 'POST') return writeJson(res, 405, { ok: false, reason: 'method-not-allowed' })

      const body = await readJsonBody(req)
      if (body === null) return writeJson(res, 400, { ok: false, reason: 'invalid-json' })

      if (rest === 'config') {
        const result = await service.setConfig(body)
        return writeJson(res, result.ok ? 200 : 400, result)
      }
      if (rest === 'pairing/new') {
        const result = await service.newPairing()
        return writeJson(res, 200, result)
      }
      if (rest === 'pairing') {
        const result = await service.pair(body.code)
        return writeJson(res, result.ok ? 200 : 400, result)
      }
      if (rest === 'leave') {
        return writeJson(res, 200, await service.leave())
      }
      if (rest === 'interact') {
        const result = await service.interact(body)
        return writeJson(res, result.ok ? 200 : 400, result)
      }
      if (rest === 'local-action') {
        const result = service.setLocalAction(body.anim)
        return writeJson(res, result.ok ? 200 : 400, result)
      }
      if (rest === 'chat') {
        const result = await service.chat(body)
        return writeJson(res, result.ok ? 200 : 400, result)
      }
      if (rest === 'update/check') {
        const result = await service.checkUpdate()
        return writeJson(res, 200, result)
      }
      return writeJson(res, 404, { ok: false, reason: 'not-found' })
    } catch (error) {
      return writeJson(res, 500, {
        ok: false,
        reason: 'internal-error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
