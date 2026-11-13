# 发布说明（dsh-pet-online）

**已发布**：GitHub Release `v0.4.0`
<https://github.com/sunbinggang/dsh-pet-online/releases/tag/v0.4.0>
（资产 `dsh-pet-online-0.4.0.tgz`，35,409 字节，CI 里 `npm test` + `npm pack` 通过后自动上传）

- 仓库：<https://github.com/sunbinggang/dsh-pet-online>
- 安装（Release 资产）：从上面的 Release 下载 tgz，或
  `dsh plugin add github:sunbinggang/dsh-pet-online#v0.4.0`（dshmarket 支持 `github:` 源）
- npm 公共 registry 仍未发布：本机 npm 未登录（`npm whoami` → ENEEDAUTH），且默认 registry 是
  `registry.npmmirror.com`（只读镜像）。需要时按下文「方式 A」登录后发布即可，包已通过 `npm publish --dry-run`。

## 方式 A（可选）：发布到 npm 公共 registry

```powershell
cd C:\Users\win\Documents\deepseek-harness\default-workspace\dsh-pet-online
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

发布后用 `npm view dsh-pet-online version` 确认；DSH 商城/其它机器即可 `dsh plugin add dsh-pet-online`。

> 不想交互登录时，可在 CI 设置 `NPM_TOKEN` 并在仓库根放 `.npmrc`：
> `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`

## 方式 C：本地 tarball 安装（不发布也生效）

```powershell
npm install --prefix "$env:USERPROFILE\.dsh\profiles\desktop" `
  "C:\Users\win\Documents\deepseek-harness\default-workspace\dsh-pet-online\dsh-pet-online-0.4.0.tgz"
```

然后确认 `dsh.profile.bundles` 含 `dsh-pet-online`，重启 DSH。
（当前 profile 已用 junction 指向工作目录，效果等同，且改代码即生效。）

## 发布前自检

```bash
node --test test/*.test.js     # 15 passed
node scripts/selfcheck.mjs     # ✅ 全链路 OK
npm pack --dry-run --json      # 17 files / 35323 bytes
```

`package.json` 的 `files`、`icon.svg`、`dsh.bundle.patch`、`dsh.client`、`dsh.compatibility` 均已就位；
`.github/workflows/release.yml` 在推 `v*` tag 时自动跑测试、打包并创建 Release。
