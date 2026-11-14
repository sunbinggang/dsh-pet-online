# dsh-pet-online 🐾🌐

给 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 桌宠加一层**在线联机**：两台（或多台）装了 DSH 的机器输入同一个配对码，就能互相看见、互动、跨机聊天。

**仓库**：<https://github.com/sunbinggang/dsh-pet-online> · **发布**：<https://github.com/sunbinggang/dsh-pet-online/releases/latest>

**不改 dsh-pet 源码，不 import 它的模块**——只走它公开的 `/dsh-pet-7340/*` 路由（`/state` 长轮询、`/config`、`/broadcast`、`/anim`、`/throw`、`/chat`、`/sleep`、`/wake`）。

## 现在能做什么（v0.8）

- **配对**：一方生成 6 位配对码，另一方输入，即进入同一 relay 房间。
- **在线列表**：设置页「桌宠联机」里看到同房间的设备（名字、宠物、在线状态）。
- **投影**：远端宠物以「访客精灵」出现在 DSH 浮动层上，跟它的动作、气泡、睡觉状态走。
- **访客物理**：访客精灵有自己的重力/落地回弹/边界反弹/彼此碰撞，可以拖拽抛掷、点一下戳对方（走独立物理循环，不会推动你本机的桌宠）。
- **右键菜单**：打招呼 / 投喂 / 摸摸头 / 戳一下 / 抱抱 / **哄睡·叫醒** / **动作…（对方宠物的全部动作）** / 共享当前音乐 / 留言 / **发文字消息** / **AI 聊天**；菜单不再被桌宠压住，右键也不会误触发戳一下。互动失败会直接弹出原因（例如「对方宠物睡着了，先叫醒它」）。
- **睡觉感知**：对方宠物睡着时，投喂/摸摸头/动作等会先自动叫醒再执行；「哄睡」只调 `/sleep`、不再发气泡（睡觉时 dsh-pet 会拒绝广播）。
- **音乐共享（可播放同一首）**：读 dsh-music-player 最近一次播放（本地/QQ/酷狗/网易云/电台），把曲目信息共享给对方宠物；对端勾选「允许对方让我播放同一首」后自动播，未勾选时在面板出现「播放同一首」按钮。播放发生时按歌名在本机曲库找同名曲目，找不到再按在线源 id 走 `/dsh-music/{nc,qq,kg}/play/<id>`；只传元数据，不传音频。
- **本机动作同步**：旁路观察 dsh-pet 的 webm 请求，把你宠物正在播的随机动作/点击动画也实时同步给对侧。
- **跨机聊天（两种）**：面板输入框直接发**纯文字**，对端只展示、不调用模型、不耗 token；也可选「AI 回复」，让对方宠物用自己的 LLM 人设回你。两种消息都留在面板会话里。
- **忙碌降级**：对方正在专注会话时，互动只弹气泡不抢动画。
- **回执与开关**：互动回执、聊天/纯文字/音乐自动播放/气泡共享开关。
- **更新检测**：启动后查 GitHub Release 最新版本，面板显示「当前 / 最新」，有新版可**一键更新**（下载 → 备份 → 覆盖，重启 DSH 生效）或去 Release 下载；默认每 6 小时检查一次，可关。
- **隐私边界**：跨机只交换宠物摘要、互动意图与聊天文本；不含对话记忆、文件、账号。

边界：访客物理只作用于访客精灵本身（本机桌宠是独立渲染层，暂不接收联机碰撞力）。

## 安装

### 1. 前置

- DSH `0.2.1-rc.2` 及以上（桌面版）；
- 已安装并启用 `dsh-pet`，宠物可见；
- 本插件依赖 Node 22+（DSH 自带运行时满足）。

### 2. 装插件

从本目录运行（幂等，会备份 profile 的 package.json）：

```bash
node scripts/install.mjs                 # 自动找 ~/.dsh/profiles/${DSH_PROFILE:-desktop}
node scripts/install.mjs --profile <目录> # 指定 profile
```

脚本做两件事：把本包 junction 到 `<profile>/node_modules/dsh-pet-online`，并把 `dsh-pet-online` 加进 `dsh.profile.bundles`。

重启 DSH 后，设置页会出现「桌宠联机」。

### 3. 启动 relay（任一台机器）

```bash
node relay/server.mjs            # 默认 7420
node relay/server.mjs 7421       # 自定义端口
```

relay 是零依赖的纯 Node 服务：房间内存聚合、帧转发、限流；**不落盘、不解析业务内容**。局域网内一人起一个即可，其他人把 relay 地址填成 `ws://<那台机器IP>:7420/ws`。

> 默认 `relayUrl` 是 `ws://127.0.0.1:7420/ws`（本机自测用）。跨机联机时在面板/配置里改成对方 IP。

### 4. 配对

1. A 打开 设置 → 桌宠联机 → **生成配对码**；
2. B 输入这 6 位码 → **加入**；
3. 双方在线列表里出现彼此，点「打招呼」试试。

配对码 10 分钟内有效；断开后房间自动消失。

## 配置

配置文件：`$DSH_HOME/dsh-pet-online/config.json`（面板保存时写回）。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `relayUrl` | `ws://127.0.0.1:7420/ws` | relay 地址（跨机改中继机局域网 IP） |
| `autoRelay` | `true` | 地址为本机时自动起 relay（端口占用则跳过） |
| `nickname` | `""` | 联机昵称，留空用宠物名 |
| `acceptInteractions` | `true` | 是否接受别人互动 |
| `acceptChat` | `true` | 是否接受跨机聊天（AI 回复会消耗本机模型 token） |
| `acceptRawChat` | `true` | 是否接受纯文字消息（不经过模型） |
| `acceptRemoteMusic` | `false` | 是否允许对端让我自动播放同一首（关时只给手动按钮） |
| `shareBubbles` | `true` | 是否共享气泡文字 |
| `maxPeers` | `8` | 同房间最多显示多少台 |
| `updateCheck` | `true` | 自动检查 GitHub Release 新版本（每 6 小时） |
| `pairCode` | `""` | 上次配对码（自动重连用） |

## 协议速览

帧：`{ v:1, type, from?, to?, payload }`，JSON over WebSocket，单帧 ≤ 64 KiB。

| 类型 | 方向 | 用途 |
|---|---|---|
| `hello` | 插件→relay | 加入房间，带 deviceId/昵称/宠物 |
| `welcome` | relay→插件 | 回当前在线列表 |
| `presence` | 插件→插件 | 宠物摘要（名/大小/动作/气泡/睡觉），变化时 1s 内合并发送，空闲 15s 保活 |
| `interaction` | 插件→插件 | `{msgId,intent,note,fromName,track?}`，intent 见下 |
| `reaction` | 插件→插件 | 互动回执 `{msgId,ok,reason,mode}` |
| `chat` | 插件→插件 | 跨机聊天 `{msgId,text,fromName,raw?}`；`raw:true` 即纯文字 |
| `chat-reply` | 插件→插件 | 聊天回复 `{msgId,ok,text|reason|ack}` |
| `peer-leave` | relay→插件 | 对端断开 |

面板与投影侧另有本机路由：

- `GET /dsh-pet-online/state`：面板快照（连接状态、配对码、在线设备、回执、更新检查）；
- `GET /dsh-pet-online/events?since=&timeout=`：覆盖层长轮询，版本变化即返回远端宠物摘要（含 `assetRoot`，用于取本机 dsh-pet 的同名 webm）；
- `GET /dsh-pet-online/music/now`：读 dsh-music-player 最近播放的曲目；
- `POST /dsh-pet-online/local-action`：浏览器半侧上报「本机正在播的动画名」，宿主立刻广播（随机动作/点击动画也能同步）；
- `POST /dsh-pet-online/music/play`：面板点「播放同一首」，把某条分享排队给本机浏览器播放；
- `POST /dsh-pet-online/update/check` / `POST /dsh-pet-online/update/apply`：检查更新与一键更新（下载 → 备份 → 覆盖，重启生效）。

互动意图：`wave/treat/pet/poke/hug/visit-note/music/sleep/wake/action`。远端不能传任意动画名：`action` 的动作名必须在该宠物的动作清单里（`/config` 的 animations），否则本机拒绝；其余动画由**本机**从本机宠物自己的池子里挑，文案由本机模板拼装，避免注入与素材不存在。

## 安全边界

- 只建议在可信网络使用；MVP 的 relay 是明文 `ws://`，没有账号体系。
- relay 只做转发，不落盘；房间码不是密码，知道配对码的人可以加入同一房间。
- 面板 API 只服务回环地址，并校验 Host/Origin 同源。
- 互动限流：每对设备 6 次/分钟；relay 单连接 40 帧/秒、单帧 ≤ 64 KiB、房间 ≤ 8 台。
- 跨机只交换宠物摘要与互动意图，不含对话记忆、文件、账号。

## 开发

```bash
node --test test/*.test.js     # 37 个测试：协议 / relay / 宿主 / 本机桥 / 浏览器契约 / 双实例端到端
node scripts/selfcheck.mjs     # 不开 DSH 跑一遍完整联机链路，打印每一步
node scripts/livecheck.mjs     # 真机联调：用新代码直接对接运行中的 dsh-pet（默认 62142）
node scripts/install.mjs       # 装进本地 profile（幂等）
```

`livecheck` 需要本机 DSH 正在运行，会临时起一个联机实例并模拟第二台设备，往你的桌宠弹一条「留言」气泡。

自检输出示例：

```
▶ 启动 relay
▶ 双方输入同一配对码
  ✓ relay 已连接：pair:TEST23
▶ A 向 B 打招呼
  ✓ B 收到 /anim
  ✓ 回执：ok=true mode=full
✅ 全链路 OK
```

目录：

```
lib/protocol.js     两端共用协议（帧形状、意图、清洗）
lib/local-bridge.js 本机 dsh-pet HTTP 桥（状态/配置/动作）
lib/relay-client.js  relay 客户端（重连/心跳）
lib/service.js      编排层（presence 发布 + 互动处理 + 面板快照）
lib/routes.js       面板 API（/dsh-pet-online/*）
lib/index.js        cordis 插件入口
client.js           浏览器半侧（设置页面板）
relay/server.mjs    零依赖 WS relay
```

## 排查

- **面板显示「未连接」**：默认地址是 `127.0.0.1` 时插件会自动起 relay；如果仍离线，通常是端口被占/被防火墙拦，或地址写成了别的机器但连不上。跨机时把「中继地址」改成中继机的局域网 IP（如 `ws://192.168.1.10:7420/ws`），并在中继机放行 TCP 7420。
- **配对成功但看不到对方宠物**：先看在线列表里有没有对方（没有 = 两边没连到同一个 relay/房间）；有对方但只显示名字标签 = 本机 dsh-pet 没有对方那种宠物的动画素材（`assetRoot` 不同），属预期降级。
- **重连慢**：断线后按 1s→2s→…→30s 退避，最长约半分钟；面板会显示当前状态。

## 发布清单

- `icon.svg`（≤256 KiB，随包发布），`package.json` 的 `dsh.bundle.patch` + `dsh.client` 已就位；
- `cordis.patch.yml` 的 entry id 为 `dsh-pet-online`（与包名一致、无行尾注释）；
- `files` 只发 `lib / client.js / relay / scripts / cordis.patch.yml / README.md / CHANGELOG.md / LICENSE / icon.svg`；
- `dsh.compatibility.dshReleases` 按实测版本维护，只留最新三版；
- 打包自检：`npm pack --dry-run --json` 核对文件清单；`node --test` 与 `selfcheck` 全绿后再提交。

## License

MIT。素材（宠物动画）版权归 dsh-pet 作者，本插件不打包任何素材。
