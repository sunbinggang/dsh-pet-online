#!/usr/bin/env node
/**
 * 把 dsh-pet-online 装进本地 DSH profile（幂等）：
 *   1. 在 <profile>/node_modules 下建一个指向本包的 junction（Windows 不需要管理员权限）；
 *   2. 把 "dsh-pet-online" 加进 <profile>/package.json 的 dsh.profile.bundles；
 *   3. 备份原 package.json，打印重启提示。
 *
 * 用法：
 *   node scripts/install.mjs                     # 自动找 ~/.dsh/profiles/${DSH_PROFILE:-desktop}
 *   node scripts/install.mjs --profile <dir>     # 指定 profile 目录
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

function argProfile() {
  const index = process.argv.indexOf('--profile')
  if (index >= 0 && process.argv[index + 1] !== undefined) return resolve(process.argv[index + 1])
  return join(dshHome(), 'profiles', process.env.DSH_PROFILE || 'desktop')
}

async function main() {
  const profile = argProfile()
  const pkgPath = join(profile, 'package.json')
  if (!existsSync(pkgPath)) {
    console.error(`找不到 profile：${pkgPath}\n先确认 DSH 已启动过、profile 名称正确（或传 --profile <目录>）。`)
    process.exitCode = 1
    return
  }

  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  pkg.dsh = pkg.dsh ?? {}
  pkg.dsh.profile = pkg.dsh.profile ?? {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  if (!bundles.includes('dsh-pet-online')) {
    const backup = pkgPath + '.dsh-pet-online.bak'
    if (!existsSync(backup)) await writeFile(backup, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    bundles.push('dsh-pet-online')
    pkg.dsh.profile.bundles = bundles
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    console.log('✓ 已把 dsh-pet-online 写进 dsh.profile.bundles（备份：' + backup + '）')
  } else {
    console.log('· dsh.profile.bundles 里已有 dsh-pet-online，跳过')
  }

  const link = join(profile, 'node_modules', 'dsh-pet-online')
  await mkdir(dirname(link), { recursive: true })
  if (existsSync(link)) {
    console.log('· node_modules/dsh-pet-online 已存在，跳过')
  } else {
    await symlink(PACKAGE_ROOT, link, 'junction')
    console.log('✓ 已创建 junction：' + link + ' → ' + PACKAGE_ROOT)
  }

  console.log('\n下一步：重启 DSH（宿主插件只在启动时装配），然后 设置 → 桌宠联机 → 生成配对码。')
  console.log('联机前另起一个 relay：node relay/server.mjs（默认 7420，局域网放行 TCP 入站）')
}

main().catch((error) => {
  console.error('安装失败：', error)
  process.exitCode = 1
})
