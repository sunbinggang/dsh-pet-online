# 发布说明（dsh-pet-online）

包已整理到可发布状态：`npm pack` 产出 `dsh-pet-online-0.4.0.tgz`（17 个文件，35 KB），
`npm publish --dry-run` 通过；真正发布只差 **npm 账号凭据**。

本机现状：`npm` 未登录（`npm whoami` → ENEEDAUTH），且默认 registry 是 `registry.npmmirror.com`
（只读镜像，不能发布）。以下任选一条路。

## 方式 A：发布到 npm 公共 registry（推荐，DSH 商城可直接索引）

```powershell
cd C:\Users\win\Documents\deepseek-harness\default-workspace\dsh-pet-online
npm login --registry=https://registry.npmjs.org
npm publish --access public --registry=https://registry.npmjs.org
```

发布后用 `npm view dsh-pet-online version` 确认；DSH 商城/其它机器即可 `dsh plugin add dsh-pet-online`。

> 如果不想交互登录，也可以在 CI/终端设置 `NPM_TOKEN`，并在仓库根放 `.npmrc`：
> `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`

## 方式 B：GitHub Release（dshmarket 支持 `github:` 源）

1. 把本目录提交为一个公开仓库，`package.json` 增加 `repository` / `homepage` / `bugs`（指向该仓库）；
2. 打 tag `v0.4.0`，上传 `dsh-pet-online-0.4.0.tgz` 到 Release；
3. 商城条目可用 `github:<owner>/<repo>#v0.4.0` 形式引用（需在仓库里保留 `package.json`、
   `cordis.patch.yml`、`lib/`、`client.js`）。

需要你提供仓库地址后，我可以把 `repository` 字段和 Release 说明补全。

## 方式 C：只用本地 tarball 安装（不发布）

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

`package.json` 的 `files`、`icon.svg`、`dsh.bundle.patch`、`dsh.client`、`dsh.compatibility` 均已就位。
