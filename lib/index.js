/**
 * dsh-pet-online 宿主半侧入口（cordis 插件）。
 *
 * - 依赖 webServer 注册自己的面板路由；
 * - 通过回环 HTTP 读本机 dsh-pet 的 /state 与 /config，并调用它的动作端点；
 * - 通过 relay 客户端与其它 DSH 实例交换宠物摘要与互动意图。
 *
 * 不 import dsh-pet、不改它的文件：契约只认 /dsh-pet-7340/* 路由。
 */

import { ROUTE_SEGMENT } from './protocol.js'
import { createOnlineService } from './service.js'
import { createRouter } from './routes.js'

export const name = 'dsh-pet-online'

export const inject = ['webServer']

export function apply(ctx) {
  const service = createOnlineService(ctx)
  const handle = createRouter(service)

  ctx.effect(() => {
    service.start()
    return () => service.stop()
  }, 'dsh-pet-online: service')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_SEGMENT,
        handler: handle,
      }),
    'dsh-pet-online: routes',
  )
}
