# Changelog

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
