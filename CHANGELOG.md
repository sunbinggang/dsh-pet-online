# Changelog

## 0.9.0

- **多人联机**：同一个配对码可让最多 8 台设备进入同一房间，所有人互相看到对方的宠物；面板显示「房间 N/8 人」。此前协议与 relay 已按多成员实现，这次补上端到端三机测试与容量上限提示。
- 新增**群发动作**：面板「向全房间打招呼」「共享音乐给全房间」一次发给所有在线设备（`POST /interact-all`），逐台限流，返回 `sent/skipped/total`。
- 新增**群发文字**：面板「向全房间发文字」把纯文字消息一次发给所有在线设备（`POST /chat-all`）；每条都会冒在各自宠物头顶，仍不经过模型。
- 新增接口 `/dsh-pet-online/interact-all`、`/dsh-pet-online/chat-all`；`/state` 增加 `room: {members, capacity}`。
- 测试增至 41 个（含三机同房互相可见 + 群发互动/群发文字命中所有人）。

## 0.8.7

- 修复纯文字消息只进面板、对侧宠物不冒泡：收到 `raw` 聊天后，桥接层直接 `/broadcast` 到本机宠物（不经过 LLM），对侧宠物头顶会显示这条文字；睡着时先叫醒再冒泡。
- 修复投影气泡「本体已收起、对侧一直不消失」：dsh-pet 的气泡默认 10 秒收起，但 presence 一直带着旧的 `say` 文本。现在服务端按 `say` 叶子 counter 记录出现时间，超过 10 秒后推送不带气泡的 presence，投影侧同步消失；新气泡会重新计时。
- 补回归断言：纯文字消息必须触发对端 `/broadcast`。

## 0.8.6

- 修复「投喂零食」把对方宠物甩飞：dsh-pet 的 `/throw` 是物理抛掷宠物，不是投喂。现在投喂只播吃东西动画 + 气泡，不再调用 `/throw`；优先挑 `吃什么` 分类里的动作（吃白饭/大口吃零食/吃Token…），没有才退回点击动画。
- 修复「留言」「发文字消息」「AI 聊天」点了没反应：DSH 桌面壳（Electron）禁用了 `window.prompt`，而我们原来用它收输入。现在改为插件自绘的 `.dpo-compose` 输入弹层（Enter 发送、Shift+Enter 换行、Esc 关闭），面板和右键菜单都走它。
- 联机气泡补上配图，效果对齐 dsh-pet 原生碎碎念：投影的访客气泡显示对方 `say.image`（`/pic/memes/<root>/<name>.png`，文字上方）；远端互动落到本机时，桥接层按意图从本机 `memes` 池挑图（投喂→吃饱饱摸肚子、打招呼→Ciallo、哄睡→深度睡眠、戳一下→电死你…），通过 `/broadcast {text,image}` 一起弹出。
- 配图只在本机池子里挑，远端只能表达意图，不能指定本机素材名。
- 测试增至 40 个（投喂不抛掷 + 带配图、气泡图样式与渲染、禁用 prompt 回归）。

## 0.8.5

- 修复「一键更新」必然失败：更新检查的 API 兜底分支把 `tag_name` 的 `v` 前缀 normalize 掉了，下载地址被拼成 `/releases/download/0.8.4/…`，GitHub 直接 404；现在原样保留 tag（带 `v`）。
- 一键更新优先走 GitHub API 资产端点（`Accept: application/octet-stream`），而不是国内网络常被 `ECONNRESET` 的 `github.com/.../releases/download/...` 直链；直链只作最后兜底，tag 带不带 `v` 两种写法都会尝试。
- 新增回归测试：API tag 必须保留 `v`；直链被重置时能回退资产端点并完成安装（38 个测试）。

## 0.8.4

- 修复联机投影的对方宠物「气泡只剩文字、看不到白色气泡框」：气泡原来用 `--dsw-alias-bg-base` 当底色，深色主题下这个变量就是页面底色，气泡框和背景融为一体。现在气泡固定白底深字，并补上小尖角和 `z-index`，宽屏/长文本会自动换行。
- 访客气泡不再吃鼠标事件（`pointer-events:none`），拖宠物时不会被气泡挡住。
- 加回归测试：断言气泡样式必须显式白底深字、不得引用主题页面底色。

## 0.8.3

- 修复对方宠物睡着时投喂/摸摸头/动作等互动失败：dsh-pet 在睡觉期间会拒绝 `/anim`、`/broadcast`、`/chat`（`reason: sleeping`）。现在桥接层先读 `/state` 的 `pets.<id>.sleep` 判断睡眠，互动前自动 `/wake` 再执行；「哄睡」只调 `/sleep`、不再广播（否则必被拒）；已在睡时再哄睡直接成功。
- 动作清单与 dsh-pet 的 `animationNames()` 对齐：补上 turn/drag/moves/events/baifan，右键「动作…」不会再漏项或因名字不在白名单被拒。
- 右键菜单新增「发文字消息…」（`raw:true`，直达对方的宠物气泡/面板，不经过模型）与「AI 聊天…」；面板聊天输入框保留。
- 互动失败可见化：`/interact` 或 reaction 失败时按 reason 弹提示（sleeping / locked / unknown-animation / rate-limited / pet-call-failed 等），不再静默。
- 宠物睡着时 AI 聊天也会先叫醒再调用它的 LLM。
- 测试增至 37 个（睡觉自动叫醒、哄睡不广播、睡着时聊天先叫醒）。

## 0.8.2

- 修复右键菜单打开后点任何一项都没反应：访客覆盖层 `.dpo-guest-layer` 是 `pointer-events:none`，菜单和遮罩没有恢复 `pointer-events:auto`，整块菜单对鼠标透明。现在菜单容器、菜单项、遮罩都显式 `auto`，菜单内 pointerdown 不再冒泡；禁用项样式也补上。
- 加回归测试：解析注入的 CSS，断言菜单相关选择器都带 `pointer-events:auto`。

## 0.8.1

- 修复更新检查失败 `HTTP 403`：`api.github.com` 对未登录请求按出口 IP 限流，很容易整段共享 IP 被拒。改为优先读 `https://github.com/<repo>/releases/latest` 的 302 `Location`，其次 `releases.atom`，API 只作最后兜底。
- 一键更新同步去掉对 API 的依赖：按约定资产名 `dsh-pet-online-<版本>.tgz` 直接走 `releases/download/<tag>/...` 下载，失败才回退 API 资产列表。
- 新增 tag 解析（Location/atom）与「全通道 403」测试，测试增至 33 个。

## 0.8.0

- 音乐共享升级为「播放同一首」：共享时连同曲目 id/歌名/歌手/来源一起发给对端；对端勾选「允许对方让我播放同一首」后自动播，未勾选时面板出现手动「播放同一首」按钮。播放端按歌名在本机 `/dsh-music/manifest` 找同名曲目（歌手需出现在 path），找不到再按来源走 `/dsh-music/nc|qq|kg/play/<id>`，都没有则提示；浏览器拦截自动播放时给重试按钮。
- 新增纯文字跨机聊天：消息带 `raw:true`，对端直接展示、**不调用 LLM、不耗 token**；面板聊天卡片改为输入框 +「发送」，原「聊天」改名「AI 聊天」。
- 修复右键菜单不可用：`GuestPet` 只接管左键 pointerdown（右键不再被 preventDefault 吞掉 contextmenu，也不误触发 poke）；菜单打开时把访客层提到桌宠之上（`dpo-menu-open`）。
- 右键菜单接入 dsh-pet 的睡觉与动作：新增「哄睡/叫醒」（按对方是否 sleeping 切换）与「动作…」子菜单（列出对方宠物全部动作，带返回）。
- `bridge.applyIntent` 新增 `sleep/wake/action`：动作名必须在该宠物动作清单内，否则拒绝（`unknown-animation`）。
- 偏好新增 `acceptRawChat`（默认开）与 `acceptRemoteMusic`（默认关）；`setConfig` 只在连接参数变化时重连，避免改一个开关就短暂掉线丢互动。
- 新增 `POST /music/play`；测试增至 30 个（睡觉/叫醒/动作、纯文字不走 LLM、音乐默认不自动播/勾选后自动播）。

## 0.7.0

- 一键更新：面板「一键更新」直接下载 Release 的 tgz、解包并覆盖本包目录，覆盖前自动备份到 `$DSH_HOME/dsh-pet-online/backups/`，完成后提示重启 DSH。
  - 下载优先走 GitHub API 资产端点（`Accept: application/octet-stream`），部分网络下 `github.com` 直链不可达时的兜底；解包拒绝绝对路径/`..`，总量上限 40 MB。
  - 新增 `POST /dsh-pet-online/update/apply`；已是最新或没有 tgz 资产会明确返回原因。
- 修面板「检查更新」一带白字白底：卡片/按钮显式设文字色，主按钮固定白字蓝底，链接按钮不再继承异常颜色。
- 测试增至 23 个（tar 解析、路径穿越拒绝、tgz 解包、一键更新拒绝路径）。

## 0.6.0

- 访客宠物右键菜单：打招呼 / 投喂零食 / 摸摸头 / 戳一下 / 抱抱 / 共享当前音乐 / 留言。
- 音乐共享：宿主读 dsh-music-player 的 `GET /dsh-music/prefs`，取最近一次播放的曲目（本地/QQ/酷狗/网易云/电台），以 `music` 意图把「歌名 - 歌手」发给对端，对端宠物弹气泡并做动作（不传音频）。
- 本机动作同步：浏览器半侧旁路观察 dsh-pet 的 `/dsh-pet-7340/thumb/<root>/<anim>.webm` 请求，把正在播的动画名经 `POST /dsh-pet-online/local-action` 上报，宿主立刻广播给对端；随机动作/点击动画也能同步，不只是 `/state` 里有的动作。
- 新增路由：`GET /music/now`、`POST /local-action`。
- 测试增至 20 个（音乐偏好读取用真实 key 形态：`dsh-music-*-playback`）。

## 0.5.0

- 新增更新检测：插件启动后查询 GitHub Release 最新 tag，与本机版本比较；面板「版本与更新」显示当前/最新版本，发现新版本给「去下载」，另有「检查更新」按钮与自动检查开关（默认开，每 6 小时一次）。
- `GET /dsh-pet-online/state` 增加 `pluginVersion` 与 `update` 字段；新增 `POST /dsh-pet-online/update/check`。
- 更新检查失败只记错误、不阻塞；离线环境不影响联机。
- 测试增至 19 个（版本比较、新版本/已最新/网络失败三种检查）。

## 0.4.3

- 修复「对方宠物不能正常显示」：远端宠物没有动作名时，presence 现在携带待机动画名（`idle`），访客精灵用它循环播放；仍取不到素材时回退到本机 dsh-pet 的角色图（`/character?root=`），不再是空白。
- presence 改为「一上线 / 发现新对端就立刻发一帧」，不再等 15s 保活或状态变化；`device` 同时带 `id` 与 `deviceId`。
- 远端 `anim` 支持 http(s) 地址直接当视频源。
- 测试补 idle 字段断言。

## 0.4.2

- 修 CI 卡住：`npm test` 改为无参发现 + `--test-force-exit`（Windows 的 cmd 不展开 `test/*.test.js`，Node 也不 glob）；工作流固定 Node 24。
- 修自动中继换端口不生效：`relayUrl` 在本机地址之间切换时先关旧 relay 再按新端口启动；端口被外部 relay 占用则跳过。
- 测试：自动中继用例加 try/finally，失败时也会释放中继，避免测试进程挂起。

## 0.4.1

- 修复「显示未连接、看不到对方宠物」：默认地址指向 `127.0.0.1` 时，插件会**自动在本机启动 relay**（端口被占用则跳过，说明已有中继）；`autoRelay` 默认开。
- 面板新增「中继地址」输入框：跨机时把 `ws://127.0.0.1:7420/ws` 改成中继机器的局域网 IP，保存即重连。
- 离线时面板给出明确提示（自动中继 / 跨机 IP / 防火墙放行 TCP 7420）。
- 测试：新增「本机自动中继」端到端用例，总计 16 个。

## 0.4.0（P1）

- 跨机聊天：`chat` / `chat-reply` 帧；面板每台设备一条会话，消息走对方 dsh-pet `/chat`（人设 + 记忆），双方记录留在面板；限流 3 条/分钟/设备，可关。
- 访客物理：访客精灵自带走动、重力、落地回弹、边界反弹、彼此碰撞，可拖拽抛掷、点按戳对方；本地 rAF 物理循环，不阻塞本机桌宠。
- 面板新增「跨机聊天」卡片与「接受聊天」开关。
- 发布项：`icon.svg`、files 清单、发布清单写入 README；版本 0.4.0。

## 0.3.2（M4 真机联调）

- 新增 `scripts/livecheck.mjs`（`npm run livecheck`）：用当前代码起联机实例、直接对接运行中的 dsh-pet（默认 62142），模拟第二台设备走「在线 → 留言 → 回执」，实测通过。
- 真机证据：读到 `main.pets[0]=蓝毛小女仆`；`visit-note` 成功写入真实桌宠气泡并收到回执。

## 0.3.1（M4）

- 新增 `scripts/install.mjs`（`npm run install:profile`）：幂等安装进本地 profile（junction + bundles 条目 + 备份），临时 profile 实测通过。
- 浏览器半侧契约测试：vm 沙箱加载 `client.js`，验证 `inject: ["slots"]` 与 `settings.section`、`shell.overlay` 两个注册。
- 本机宠物清单改为独立 15s 刷新：relay 未连时面板/投影也能看到自己的宠物。

## 0.3.0（M3）

- 忙碌降级：本机 `focusSession` 5 分钟内有写入时，远端互动只弹气泡、不播动画/不抛掷，回执带 `mode: "bubble"`。
- 新增 `scripts/selfcheck.mjs`（`npm run selfcheck`）：不开 DSH 跑通配对 → presence → 互动 → 对方本机动作 → 回执，并逐步打印。
- 测试增至 13 个：本机桥 bubbleOnly/localPets、双实例端到端、专注降级端到端。

## 0.2.0（M2）

- 远端宠物投影：`shell.overlay` 访客精灵，按远端 presence 的动作 / 气泡 / 坐标 / 睡觉状态渲染，素材复用本机 dsh-pet 的 `/thumb` webm。
- 覆盖层长轮询 `/events?since=&timeout=`（版本号收敛，断线回来不重影）。
- 配对码 = 房间码，relay 房间上限 8 台；面板显示最近三条互动回执。
- 本地宠物清单改为按 `/config` 的条目树展开（修 M1 里把 `{main:{pets}}` 当扁平 `{pets}` 的问题）。

## 0.1.0（M1）

- 首个可用版本：配对码房间、在线列表、五种互动意图、互动回执、限流、隐私开关。
- 零依赖 WS relay；协议层与 relay 端到端测试。
