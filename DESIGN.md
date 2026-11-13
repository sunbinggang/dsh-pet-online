# dsh-pet-online —— dsh-pet 在线联机插件 · 详细设计与开发计划

> 版本 v0.1（草案）· 2026-11-13
> 目标：让多台机器（多个 DSH 实例）上的 dsh-pet 桌宠「看见彼此」：跨设备互访、一起玩、互扔零食/互扔宠物，以及跨设备聊天接力。

---

## 0. 结论先行（TL;DR）

- **架构选型：中继服务器（relay）+ 插件侧「影子投递器」**，不改动 dsh-pet 源码、不改 DSH 核心，全部能力通过一个新 DSH 插件 `dsh-pet-online` 实现。
- **关键洞察**：dsh-pet 已经把「对宠物的一切操作」收敛成了同进程 HTTP 路由 `/dsh-pet-7340/*`（`anim` / `whisper` / `bubble` / `pose` / `throw` / `position` / `sleep` / `wake` / `playback` / `chat` 等），并且宿主半侧和桌面 Electron Helper 共用同一份 `handlePetRoute`。因此**跨机操作远端宠物的最小路径 = 把本机的这些路由请求通过安全信道转发到远端机器的同一端口**，远端 dsh-pet 无需任何改动就能收到「外来的播放/投掷/气泡」请求。
- 反向（把远端宠物「投影」到本机屏幕上）有两种实现层级：MVP 采用「**逻辑投影**」——本机 UI 上画一个远程宠物的镜像精灵，状态从远端 `/state` 快照同步；进阶采用「**素材投影**」——拉取远端的 webm 素材包到本地缓存，用 dsh-pet 已有的本地动画管线播放。MVP 先做逻辑投影。
- **联机形态分三档**（MVP 只做第一档）：
  1. **围观 / 串门**：能看到对方宠物在自己屏幕上散步（只读投影 + 主动投掷）。
  2. **同屏共处**：两台机器的宠物物理碰撞、互扔物品（依赖抛掷转发 + 素材投影）。
  3. **对话接力**：两只宠物通过各自的 LLM 跨机聊天（走 `/chat` 转发 + 消息总线）。

---

## 1. 现状分析（dsh-pet v0.4.7 事实核查）

以下均来自本机 `node_modules/dsh-pet` 实际代码（`lib/index.js` 9503 行 bundle + `package.json` + `cordis.patch.yml` + `assets/config.jsonc`）。

### 1.1 插件形态

| 维度 | 事实 |
|---|---|
| 插件协议 | cordis 插件，`name: "pet"`，`inject: [webServer, agentDefaultModel, credentials, llm, commands, connection]` |
| 宿主半侧入口 | `lib/index.js` → `apply(ctx)`（bundle 产物，源码 `src/host/`） |
| 浏览器半侧入口 | `exports["./client"]` → `lib/client.js`，DSH 模块系统按 `dsh.client` 注入 `@deepseek-ai/dsh-client-connection`，提供 `/plugins/dsh-pet/client.js` |
| bundle patch | `cordis.patch.yml`：`insert: - id: dsh-pet / name: 'dsh-pet'` |
| 独立模式 | `bin.dsh-pet-standalone`（不开 DSH 跑桌宠） |
| 桌面模式 | `runtime/electron-helper/`，宿主通过 spawn Electron 透明小窗，每只宠物一个局部小窗 |
| 显示位置 | 每只宠物 `display: web / desktop / both / none`（浏览器 overlay / Electron 桌面窗） |

### 1.2 HTTP 路由面（联机的「API 面」）

宿主通过 `ctx.webServer.register({ kind: "prefix", path: "/dsh-pet-7340", handler })` 挂路由，桌面 Helper 的管道与 HTTP 共用同一份 `handlePetRoute`。核心端点：

| 端点 | 方法 | 作用（联机相关性） |
|---|---|---|
| `/dsh-pet-7340/state?since&timeout` | GET | **长轮询全量状态**：sections(balance/workStatus/notify/config/menu/focusSession) + pets 槽位（say/anim/position/throw/lock/sleep），counter 递增，`since` 相同即挂起等待，最多 10s |
| `/anim` | POST | 播放指定动画（`petId` + `name/url`），返回 `playbackId` |
| `/playback/<id>` & `/playback/<id>/report` | GET/POST | 播放生命周期：等待完成 / 上报结果 |
| `/pose` `/pose/report` | GET/POST | 姿态/朝向（含镜像） |
| `/position` `/throw` | POST | 位置与抛掷（抛掷含速度向量） |
| `/whisper` `/broadcast` `/bubble/clear` | POST | 气泡文案（碎碎念/广播/清除） |
| `/sleep` `/wake` | POST | 睡/醒（含睡梦拒绝逻辑） |
| `/lock` `/lock/release` | POST | 宠物锁定（独占，如拖拽中） |
| `/chat` | POST | 与宠物对话（走 LLM） |
| `/work-status` | GET/POST/DELETE | 工作状态联动 |
| `/menu/*` | GET/POST | 右键菜单事件 |
| `/config` `/pet-config` `/pet-display` | GET/POST | 配置读写 |
| `/models` | GET | 可用模型列表 |

**重要事实**：
- 这些路由**没有鉴权**（默认信任 localhost webServer），且桌面 Helper 也走同一处理函数 —— 意味着「把请求原样转发到远端机器的 webServer 端口」就能完全复刻本机操作。
- `/state` 的长轮询模型（counter + since）非常适合做**增量状态同步**：我们只需要在转发侧维护一个「远端 counter 游标」。
- 动画素材是 webm（`assets/webm/`，640×360 VP9-alpha），自定义素材在 `$DSH_HOME/dsh-pet/<petId>-animation/webm/`。

### 1.3 浏览器 overlay 与桌面窗

- 浏览器 overlay：DSH Web GUI 里的一层浮动窗（`display: web / both` 的宠物），JS 直接调 `/dsh-pet-7340/*`。
- 桌面窗：Electron Helper（`runtime/electron-helper/`），spawn 自宿主半侧，通过管道与 `handlePetRoute` 同一套逻辑通信。
- 联机插件要同时照顾两端：**MVP 只做浏览器 overlay + DSH 面板**（桌面 Electron 窗的远端投影放二期，避免碰 `runtime/electron-helper` 的窗口/物理代码）。

---

## 2. 设计目标与非目标

### 2.1 目标

| # | 目标 | 档位 |
|---|---|---|
| G1 | 两台（或多台）机器的宠物能互相看见（在自己屏幕上出现对方宠物的镜像） | MVP |
| G2 | 能对远端宠物做「友好互动」：打招呼（气泡）、扔零食（anim+throw）、摸摸（anim） | MVP |
| G3 | 能看到远端宠物的工作状态（忙/闲/等确认），并一键「不打扰」 | MVP |
| G4 | 宠物各自的 AI 人设能跨机聊天（我家的鱼和那边的鱼唠两句） | P1 |
| G5 | 多宠同屏：远端宠物在本机以「访客」形态参与物理（碰撞、被扔） | P1 |
| G6 | 权限模型：主人全程可控，随时断联、拉黑、仅围观 | MVP |
| G7 | 断线重连、状态收敛（counter 游标续传）、防重复投递 | MVP |

### 2.2 非目标

- 不改 dsh-pet 源码（不在本插件里 fork 它），不改 DSH 核心；
- 不做账号体系（不引入用户注册/登录；用「配对码 + 设备名」即可）；
- 不做桌面 Electron 窗的远端投影（二期考虑）；
- 不做素材级同屏物理（二期）；

---

## 3. 总体架构

```
┌────────────── 机器 A（DSH 实例 1） ──────────────┐        ┌────────────── 机器 B（DSH 实例 2） ──────────────┐
│                                                  │        │                                                  │
│  ┌─────────────┐      ┌──────────────────────┐   │        │   ┌──────────────────────┐      ┌─────────────┐ │
│  │ dsh-pet     │◄────►│ dsh-pet-online 插件  │   │        │   │ dsh-pet-online 插件  │◄────►│ dsh-pet     │ │
│  │ (宿主半侧)   │同进程 │                      │   │        │   │                      │同进程 │ (宿主半侧)   │ │
│  └─────────────┘ HTTP │  ① PetBridge (out)   │   │        │   │  ② PetBridge (in)    │ HTTP └─────────────┘ │
│                       │  ② PetBridge (in)    │   │        │   │  ① PetBridge (out)   │                      │
│  ┌─────────────┐      └──────────┬───────────┘   │        │   └──────────┬───────────┘      ┌─────────────┐ │
│  │ 浏览器 overlay│                 │               │        │              │                  │ 浏览器 overlay│ │
│  └─────────────┘                 │               │        │              │                  └─────────────┘ │
│                                  │ WSS/HTTPS     │        │              │ WSS/HTTPS                        │
└──────────────────────────────────┼───────────────┘        └──────────────┼──────────────────────────────────┘
                                   │                                       │
                                   ▼            ┌────────────┐             ▼
                                   └───────────►│ relay 服务器│◄────────────┘
                                                │ (轻量 Node │
                                                │  WebSocket │
                                                │  房间服务)  │
                                                └────────────┘
```

三方角色：
- **本机插件（PetBridge）**：每个 DSH 实例装一份 `dsh-pet-online`，它做三件事：
  1. **投影出去（out）**：把本机 dsh-pet 的 `/state` 变化 + 可交互能力「发布」到 relay 房间；
  2. **接收进来（in）**：把远端发来的互动请求（anim/whisper/throw）**以本机用户的名义**打到本机 dsh-pet 路由上；
  3. **本机 UI**：在 DSH Web GUI 注入一个「联机面板」（谁在线、在干嘛、发互动）。
- **Relay 服务器**：无状态房间/转发服务（Node + ws），不落任何业务数据，只做信令与消息扇出。开源可自部署（官方提供一个公共实例）。
- **远端投影（本机看到的「访客宠物」）**：本机插件在 DSH Web GUI 上渲染一个访客精灵（复用 dsh-pet 的 webm 素材 URL，直接引用远端 webServer 的素材地址或本地缓存），状态驱动来自远端 `/state` 的增量同步。

### 3.1 为什么选「中继」而不是 P2P

| 方案 | 优点 | 缺点 |
|---|---|---|
| 中继 relay（选） | 部署简单、NAT 友好、鉴权集中、断线重连收敛容易 | 有一台服务器依赖（可自部署） |
| P2P（WebRTC DataChannel） | 无服务器 | 打洞失败率、证书/DTLS 复杂、重连逻辑重 |
| 局域网直连（mDNS + 本地 ws） | 零依赖 | 仅限同网段；跨网失效 |
| 修改 dsh-pet 加原生在线 | 体验最顺 | 违背「不改源码」约束，升级会被上游覆盖 |

MVP 选 relay；局域网直连作为 relay 不可用时的**降级路径**（同一实现，换传输层）。

### 3.2 身份与配对（不搞账号体系）

- **设备身份**：`deviceId = 首次生成` 的 UUID（存 `$DSH_HOME/dsh-pet-online/device.json`），随插件启动上报。
- **房间与配对码**：
  - 每台机器默认进入自己的「私人房间」`room:<deviceId>`；
  - 朋友联机 = 生成 6 位配对码（有效期 10 分钟，一次性）→ 对方在面板输入 → 双方互相加入对方的房间，形成 `session:<a>|<b>`；
  - 同一 relay 可以有多个并发 session；一个设备可以同时有多个朋友在线（上限 5 个，超出提示）。
- **权限档位**（每对 session 独立，可随时改）：
  - `spectator`：只能看投影；
  - `playmate`：可发互动（anim/whisper/throw，频率限流）；
  - `companion`：playmate + 跨机聊天；
  - 黑名单：直接拒绝连接。

---

## 4. 协议设计

### 4.1 传输与帧格式

- Relay ↔ 插件：WebSocket（wss），JSON 帧，帧格式 `{ v: 1, type, seq, ts, from, to?, room, payload }`。
- 消息类型（第一版全集，后续只加不改）：

| type | 方向 | 说明 |
|---|---|---|
| `hello` | C→R | 设备握手：deviceId、昵称、宠物清单（id/name/size/display）、版本 |
| `welcome` | R→C | 房间确认 + 当前在线设备列表 |
| `pair-request` / `pair-accept` | C→R / R→C | 配对码流程 |
| `pet-state` | P→P | 状态增量：{ counter, pets:{...}, sections:{...} }（直接透传 dsh-pet `/state` 的 delta） |
| `presence` | P→P | 上线/下线/改昵称 |
| `interaction` | P→P | 互动指令（见 4.2） |
| `chat` | P→P | 跨机宠物对话 |
| `presence-heartbeat` | C→R | 保活（30s 一次，超 90s 判死） |

### 4.2 互动指令（`interaction`）的规范化

远端 → 本机的「互动请求」不是裸转发 HTTP，而是规范化成有限几种「意图」，由本机插件翻译成本机 dsh-pet 路由调用：

| 意图 | 语义 | 本机路由翻译 |
|---|---|---|
| `wave` | 打招呼 | `/anim { name: "点击回应-元气挥手" }` + `/whisper { text: "<远端宠物名>跟你打招呼啦" }` |
| `treat` | 扔零食 | `/throw { velocity }` + 随机从「吃什么」类动画池抽一个（`吃白饭/大口吃零食/吃Token…`） |
| `pet` | 摸摸头 | `/anim { name: "点击回应-害羞惊讶" }` + `/whisper { text: "被摸了摸头~" }` |
| `visit-note` | 留言 | 仅气泡（`/whisper`），无动画 |
| `poke` | 戳一下 | `/anim { name: "点击回应-傲娇生气" }` + `/whisper`（概率拒绝台词） |
| `hug` | 抱抱 | `/anim { name: "点击回应-开心跃动" }` + 气泡 |

设计要点：
- **不透传任意动画名**：远端只能选「意图」，动画由本机插件从**本机宠物自己的动画池**里挑，避免远端发来本机不存在的素材名；
- **不透传任意气泡文案**：远端只能选意图与可选短文案（≤40 字），本机侧拼装，防注入；
- **频率限流**：每对 session、每分钟互动 ≤ 6 次，超限 relay 直接丢弃并回 `rate-limited`；
- **睡觉保护**：本机宠物在睡（`sleep` 槽位有值）时，互动被本机 dsh-pet 自己的 sleepGated 拒绝，插件层不重试，直接回执「它在睡觉」给远端（这个回执本身可当成一条 `interaction-result` 帧）。

### 4.3 状态同步（投影）

- **游标续传**：本机插件对每个在线朋友的远端宠物维护 `{ since: counter }`，每次收到 `pet-state` 帧后更新游标；断线重连后带 `since` 续传。
- **收敛策略**：
  - `say` / `anim` / `position` / `throw` / `sleep` 槽位直接映射到访客精灵的渲染状态；
  - `workStatus` section 映射到「忙/闲」徽章；
  - 远端 counter 回退（远端重启）→ 全量快照重拉；
  - 投影端不维护远端宠物的物理仿真，只按「远端最后广播的位置/朝向」渲染（远端宠物怎么动，本机就怎么显示，不做本地物理补偿）。

### 4.4 跨机宠物聊天（P1）

- 通路：本机用户输入 → 本机插件 `chat` 帧 → 远端插件 → 远端 dsh-pet `/chat` 路由（走远端宠物的 LLM 人设）→ 回复 → 帧 → 本机气泡。
- 双方插件各自维护一个 `chat-memory.json`（每对 session 每只宠物一份），可清空。
- 防尬聊：冷启动时由本机宠物先打一句招呼（调本机 `/chat`，提示词注入「对方是另一台机器的桌宠」）。

---

## 5. 模块与代码结构（本插件）

```
dsh-pet-online/
├── package.json            # dsh 插件契约：main=宿主半侧, dsh.client=浏览器半侧
├── cordis.patch.yml        # insert: - id: dsh-pet-online / name: 'dsh-pet-online'
├── src/
│   ├── host/               # 宿主半侧（cordis 插件）
│   │   ├── index.ts        # name/inject/apply；inject: [webServer, logger?, commands]
│   │   ├── relay.ts        # RelayClient：wss 连接、心跳、重连、配对
│   │   ├── bridge-out.ts   # 状态发布：订阅本机 dsh-pet /state → relay pet-state 帧
│   │   ├── bridge-in.ts    # 互动接收：interaction 帧 → 本机 dsh-pet 路由调用
│   │   ├── pairing.ts      # 配对码生成/校验、会话与权限存储
│   │   ├── permissions.ts  # 档位/限流/黑名单
│   │   ├── routes.ts       # 本插件的 HTTP 路由 /dsh-pet-online-<n>/*（面板与配对 API）
│   │   └── projector.ts    # 访客投影状态机（游标、收敛、超时）
│   ├── client/             # 浏览器半侧（DSH 模块系统注入）
│   │   ├── index.ts        # 注册 UI：联机面板 + 访客精灵渲染层
│   │   ├── panel.tsx       # 联机面板（React：设备列表/配对/权限开关/聊天窗）
│   │   └── visitor.tsx     # 访客精灵：webm 播放 + 气泡（复用 dsh-pet 的 CSS/动画管线思路）
│   └── shared/             # 两端共享：协议类型、常量、帧编解码
│       └── protocol.ts
├── relay/                  # relay 服务器（独立部署单元）
│   ├── server.mjs          # Node + ws：房间、扇出、心跳、限流
│   └── README.md
└── test/                   # 单测（node --test，mock relay 与 mock dsh-pet 路由）
```

依赖策略：peerDependencies 只声明必需的 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots`、`react/react-dom`（与 dsh-pet 同套），**不依赖 dsh-pet 本身**（只对它的 HTTP 契约编程，松耦合）。

---

## 6. 关键技术点

### 6.1 如何在不改 dsh-pet 的前提下「订阅」本机状态

dsh-pet 没有暴露事件订阅 API，但有两条路：
1. **长轮询本机 `/state`**（推荐，MVP）：插件宿主半侧自己作为 HTTP 客户端，循环 `GET /dsh-pet-7340/state?since=<counter>&timeout=10000`，与真实消费端（浏览器 overlay / 桌面 Helper）完全同构，不改任何东西。
   - 注意：插件和 dsh-pet 在**同一 DSH 进程**，走 `127.0.0.1:<port>` 回环请求即可，无需改 dsh-pet；端口从 `ctx.webServer.port` 拿（dsh-pet 自己也是这么读的）。
2. （P1 优化）如果 dsh-pet 后续暴露 ctx 事件，可切换到进程内订阅，长轮询作为兜底保留。

### 6.2 如何「代表用户」操作本机宠物

- 插件直接对本机 webServer 回环地址发 `POST /dsh-pet-7340/anim|whisper|throw|...`。
- **身份标注**：凡是远端触发的互动，气泡文案由本机插件统一加「（来自 <远端宠物名>）」后缀，避免用户分不清是谁在跟宠物说话。
- **用户在忙时静默**：`focusSession` section 有值（用户正在跟 agent 会话）时，`playmate` 档的互动降级为气泡不打动画（不抢屏幕）；`spectator` 档不受影响（反正只有气泡）。

### 6.3 访客精灵（浏览器 overlay 上的远端宠物）

- 复用 dsh-pet 的 webm 素材 URL 形如 `http://<远端host>/dsh-pet-7340/character?root=<root>`（远端 webServer 若在公网不可直达，则由 relay 中转：远端插件把素材 URL 改写成 relay 侧代理地址，本机通过 relay 的 `GET /proxy/<deviceId>/...` 拉取，MVP 先支持直连、relay 代理做兜底）。
- 渲染层：本机插件在 Web GUI 注入一个独立于 dsh-pet overlay 的绝对定位层（不干扰本机宠物的物理），尺寸取远端上报的 `size`，位置/朝向/动画随 `pet-state` 增量更新。
- 访客精灵的交互受限：点击只弹「远端宠物信息卡」（昵称、主人、状态），互动通过面板发（MVP 不做在精灵上直接右键菜单，二期）。

### 6.4 安全与隐私

- **配对码一次性**：10 分钟有效、用后即焚；session 建立后凭 `deviceId + sessionToken` 通讯。
- **relay 不存内容**：relay 只做扇出，不看懂业务帧（全部 payload 对 relay 不透明）；服务器侧日志只记元数据（连接时长、帧计数）。
- **用户可控**：面板提供「一键隐身」（停止发布 pet-state，仅保留 presence）、「断开所有联机」、「拉黑某设备」。
- **私域优先**：提供「局域网模式」开关，只与同网段设备联机（mDNS 发现 + 直连 ws），不出网。
- **素材与文本审查**：跨机聊天的文本直接展示；`visit-note` 等用户可见文本限长 + 本机侧再过滤一遍控制字符。

### 6.5 可靠性

- **心跳与判死**：30s 心跳，90s 无心跳判死；重连指数退避（1s→2s→…→60s 封顶）。
- **幂等**：`interaction` 帧带 `msgId`（uuid），本机插件对最近 200 个 msgId 去重（防 relay 重发）。
- **对账**：重连成功后，本机插件主动发一次全量 `pet-state`（counter 重置快照），远端投影丢弃旧游标。

---

## 7. 开发计划（里程碑）

> 节奏假设：1 名开发（AI 结对），每里程碑 1~2 周；总计 ~6 周到 P1 完整版。每个里程碑结束都有可演示的产出。

### M0 · 地基（第 1 周）

**目标**：插件能装上、能跑、面板能打开。
- [ ] 脚手架：package.json（dsh 插件契约，参照 dsh-pet 的 `dsh`/`dsh.bundle.patch`/`peerDependencies` 结构）、cordis.patch.yml、tsdown 构建、ESM；
- [ ] 宿主半侧 `apply(ctx)` 最小实现：注册 `/dsh-pet-online-<n>/*` 前缀路由，回 `hello world` JSON；
- [ ] 浏览器半侧最小实现：DSH Web GUI 里渲染一个「联机」面板占位；
- [ ] 本地安装验证：`pnpm` link 到 profile `node_modules`，DSH 重启后插件被识别、面板可见；
- [ ] CI：typecheck / lint / node --test 骨架。

**验收**：DSH 里能看到插件和空面板；`/dsh-pet-online-<n>/ping` 返回 200。

### M1 · 本机桥接 + Relay 最小可用（第 2 周）

**目标**：本机插件能读写本机 dsh-pet 状态；relay 服务能跑。
- [ ] `bridge-out` 原型：长轮询本机 `/dsh-pet-7340/state`，把 delta 打到日志（先不上 relay）；
- [ ] `bridge-in` 原型：提供测试路由 `POST /dsh-pet-online-<n>/test/anim`，验证能驱动本机宠物播一段动画 + 弹气泡；
- [ ] relay 服务器 v0：房间 + `hello/welcome/presence/heartbeat` + JSON 帧扇出，不校验业务；
- [ ] relay 单测（mock ws 客户端）。
- [ ] `protocol.ts` 定稿 v1（帧格式 + 类型，TS 类型同时被插件与 relay 引用）。

**验收**：两个 DSH 实例（或本机双开）连上同一 relay，能在 relay 日志看到双方 presence；`test/anim` 能让本机宠物动。

### M2 · 配对 + 投影 MVP（第 3~4 周）

**目标**：两台机器配对成功，各自屏幕上出现对方的宠物（只读投影）。
- [ ] 配对码全流程（生成/输入/接受/权限档位默认 playmate）；
- [ ] `projector`：远端 `pet-state` → 访客精灵状态机（游标续传、断线收敛、counter 回退重拉）；
- [ ] 浏览器半侧访客精灵：webm 播放（素材 URL 直连远端 webServer；不可达时走 relay `/proxy`）、气泡、位置/朝向同步；
- [ ] 面板 v1：在线设备列表、配对入口、隐身开关、断开、黑名单；
- [ ] 端到端联调（两台真机或 Docker 双实例）。

**验收**：A 机器的宠物在 B 屏幕上散步（延迟 < 1s，气泡同步）；断网 30s 重连后投影恢复无重影。

### M3 · 互动 MVP（第 5 周）

**目标**：能对远端宠物发互动，宠物有真实反应。
- [ ] `interaction` 六意图（wave/treat/pet/visit-note/poke/hug）+ 翻译表（本机 dsh-pet 路由调用）；
- [ ] 限流（每 session 6 次/分钟）与 rate-limited 回执；
- [ ] 睡觉保护回执（它在睡觉）；
- [ ] 面板互动按钮（挑宠物 → 选意图 → 发送）；
- [ ] `interaction-result` 回执上屏（成功/失败/睡觉/限流，气泡提示）。

**验收**：A 扔零食给 B 的宠物，B 的宠物真的跑过去吃；A 在 B 忙时会看到降级提示。

### M4 · 打磨与发布（第 6 周）

**目标**：可发布到 DSH 商城/私装。
- [ ] 崩溃与断网矩阵测试（relay 重启 / 宠物配置变更 / DSH 重启 / 双方同时在线互踢）；
- [ ] 文档：README（安装、自部署 relay、隐私说明）、CHANGELOG；
- [ ] 打包对齐 dsh-pet 的发布链（typecheck/lint/test/format/check），files 白名单；
- [ ] 兼容性声明（`dsh.compatibility.dshReleases` 对最新三版 DSH 实测标注）；
- [ ] 公共 relay 实例部署 + 域名 + TLS；
- [ ] （可选）局域网模式 v0（mDNS 发现 + 直连）。

**验收**：从零安装到两个朋友配对成功全程 < 5 分钟；发布包通过 DSH 商城预检脚本。

### P1 · 二期（M4 之后，按需排期）

- 跨机宠物聊天（`chat` 帧 + 双方 `/chat` 路由 + 记忆存储 + 冷启动招呼语）；
- 同屏物理（素材投影 + 本地仿真远端宠物参与碰撞/被扔）；
- 桌面 Electron 窗的访客投影（需要与 dsh-pet 的 runtime/electron-helper 协作或 fork）；
- 群聊房间（>2 设备）；
- dsh-pet 上游合作：把「联机」能力以 patch 或上游 PR 形式合并回 dsh-pet（若上游感兴趣）。

---

## 8. 风险与开放问题

| # | 风险 | 应对 |
|---|---|---|
| R1 | dsh-pet 上游改路由契约（如 ROUTE_SEGMENT 变化） | 插件启动时做一次契约探测（GET /dsh-pet-7340/state 200 即通过），失败时面板提示「dsh-pet 版本不兼容」而不是报错崩 |
| R2 | 远端 webServer 素材 URL 不可达（NAT/防火墙） | relay `/proxy` 兜底 + 本地素材缓存（访客精灵用本地同名素材回退） |
| R3 | 隐私顾虑（对方能看到我的宠物状态/工作状态） | 隐身模式 + 档位默认 spectator + 工作状态可单独关闭 |
| R4 | relay 被滥用 | 配对码门槛 + 限流 + 无业务数据落盘（封禁策略：单 IP 并发房间数上限） |
| R5 | 桌面 Electron 窗的宠物与浏览器 overlay 行为不一致 | MVP 明确只做浏览器 overlay 投影；桌面窗宠物只做「互动接收方」（bridge-in 打本机路由，桌面窗自己会动） |
| R6 | dsh-pet 的 sleepGated 等内部保护依赖内部状态，插件层无法预判 | 接受「先发后退避」模式：互动失败回执带回 reason，投影层显示「睡了/忙」 |

**开放问题（待用户/上游确认）**：
- 公共 relay 是否要官方域名，还是只支持自部署（影响 M4 工作量）；
- 跨机聊天是否要接入 DSH 的会话模型（走 agent 会话）还是直接用 dsh-pet 的 `/chat`（后者简单，但 LLM 计费落在被互动方的 DSH 实例上，需要默认征得被互动方同意——拟默认 `companion` 档开启时明示「对方可消耗你的 token」）；
- 访客精灵是否需要动画素材的跨机拉取授权（拟默认允许，因为素材本来就是公开包内的 webm）。

---

## 9. 附录 A：`interaction` 帧示例

```json
{
  "v": 1,
  "type": "interaction",
  "seq": 42,
  "ts": 1763008200000,
  "from": "dev-a1b2c3",
  "to": "dev-d4e5f6",
  "room": "session:dev-a1b2c3|dev-d4e5f6",
  "payload": {
    "msgId": "i-7f3k9x",
    "intent": "treat",
    "petId": "main",
    "note": "给你家的小家伙投喂了一包小鱼干",
    "fromPet": { "id": "main", "name": "蓝毛小女仆" }
  }
}
```

## 10. 附录 B：`pet-state` 增量帧示例

```json
{
  "v": 1,
  "type": "pet-state",
  "from": "dev-d4e5f6",
  "room": "session:dev-a1b2c3|dev-d4e5f6",
  "payload": {
    "deviceId": "dev-d4e5f6",
    "counter": 1733625900123,
    "pets": {
      "main": {
        "say": { "counter": 1733625900110, "data": { "text": "今天也要好好干活哦~", "from": "远程" } },
        "anim": { "counter": 1733625899900, "data": { "playbackId": "pb-...", "name": "螃蟹走路" } },
        "position": { "counter": 1733625899700, "data": { "x": 0.72, "y": 0.85, "facing": "right" } }
      }
    },
    "sections": {
      "workStatus": { "counter": 1733625800000, "data": { "level": 1, "text": "正在处理任务呢" } }
    }
  }
}
```

---

*本设计基于 dsh-pet v0.4.7 与 DSH 0.2.x 插件契约编写；dsh-pet 路由契约若变更，按 §8-R1 的探测降级处理。*
