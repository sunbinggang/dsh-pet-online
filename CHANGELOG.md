# Changelog

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
