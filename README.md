# Yachiyo Live2D Studio

## 0.2.4 人声口型同步修复

成品歌照常导入歌单，再点歌曲右侧的「人声」，选择 **RVC 混音前的纯人声文件**。应用仅在本机分析并保存轻量口型数据，不复制或重复播放人声，也不调用 LLM。纯人声保留与成品相同的前奏空白；口型按当前歌曲的播放时间读取，暂停、拖动进度、缓冲、切歌及音量调整都不会让两条时间轴漂移。人声参考支持 WAV / MP3 / FLAC / OGG / M4A，最大 256 MB、20 分钟。

没有关联人声的旧歌仍可播放，但保持闭嘴；纯伴奏也不会再触发口型。当前歌曲下可以更换/移除关联，设置口型偏移（负值提前、正值延后，±5000 ms）及静音门限。间奏漏音时调高门限，轻声被过滤时调低。歌曲及关联数据均保存在本机 `rvc-songs/`，重启或升级保留，删除歌单副本时一起清理，原始文件不受影响。

这是一套人声能量驱动的开合口型，并非音素识别或自动人声分离。仅有混音成品时需先获取/分离纯人声；误选成品或残留较多伴奏的人声轨仍会影响口型。人工视听可用偏移修正设备输出延迟。


## 0.2.3 本地 RVC 唱歌与右侧控制栏折叠

在舞台上选择「唱歌模式」→「导入歌曲」，可多选已经推理好的 RVC 成品，支持 WAV、MP3、FLAC、OGG、M4A（单首最多 512 MB）。歌曲会复制到应用数据目录的 `rvc-songs/`，重启和升级后仍保留；从歌单删除只移除本地副本，不改动原文件。支持播放/暂停、停止、下一首、拖动进度、音量与顺序播放，歌单播完停止；应用启动不会自动播放。播放不调用 LLM、TTS 或 RVC 推理服务。

口型配置见上方 0.2.4 说明。切换到唱歌模式会取消当前 AI 回复及排队语音，暂停点歌音乐、自动互动和游戏播报。弹幕仍可查看；切回聊天或游戏模式恢复已开播的自动互动。唱歌可以单独播放，不必先开始 AI 直播。

已开播时计时继续：进入收尾阶段，当前歌曲自然结束后转回聊天收尾，不再顺序播放下一首；到达截止时间则先停止歌曲，再执行原有告别流程。OBS/B站推流仍需手动结束。

舞台右上角箭头可折叠/展开右侧控制栏，记住选择。折叠后舞台扩宽，歌曲不停播，底部仍保留播放、暂停、停止和切歌。唱歌模式把直播时长与主题收进折叠区，给歌单留出空间。

验证：`node --test tools/desktop/tests/rvc.test.mjs` 覆盖歌曲库持久化、范围读取、来源/路径限制、删除与播放取消；`electron tools/desktop/verify-singing.mjs` 使用真实 Electron/Cubism 与本地 WAV，覆盖口型、播放控制、模式互斥、计时收尾、顺序播放、重启和 1440/960/720 布局。此验证不调用真实服务商，Windows/Linux 仍需实机验收。

## 0.2.2 直播状态、定时收尾与折叠工作空间

只有在舞台点击“开始直播”后，弹幕才会触发 AI 回复、直接朗读和点歌。旧配置中的“首条弹幕自动开播”不再生效；待机时仍可连接并查看弹幕，但不会把待机消息带入下一场回复队列。停止会取消生成、播放和待处理弹幕。

开播前可填写直播时长（默认 60 分钟，0 为不限时）与提前收尾时间（默认 5 分钟）。开播后显示已播时长、剩余时长和预计结束时间；进入收尾阶段时主动引导总结与感谢，后续回复保持简短，不再开启长话题或追加点歌。短直播的收尾窗口最多占总时长的三分之一，避免刚开始就告别。时间由本地绝对截止时间计算，睡眠恢复后不会从暂停处继续倒数。到时等待现有回复完成、生成最后的感谢告别，告别语音播放完成后自动停止 AI 主播；服务无响应时最多再等待 90 秒。此计时控制 AI 主播，OBS/B站等推流工具仍需由主播结束推流。

左侧工作空间默认折叠为图标栏，可通过顶部按钮展开/折叠，记住选择；折叠后直播舞台自动扩宽。所有导航和设置仍可访问。

0.2.2 已提供 Windows x64、macOS Apple Silicon / Intel、Linux x64 / arm64 安装包，继续包含 Windows 旧卸载器修复。真实 Electron/Cubism 界面、收尾语音播放顺序、待机弹幕拦截和布局验证见 `output/live-session/verification.json`；验证使用本地 LLM/TTS 夹具，不连接真实服务商。

## 0.2.1 Windows 安装修复

0.1.0、0.1.1 和 0.2.0 的 macOS 交叉构建遗漏了 NSIS `WriteUninstaller` 的 PE 资源补丁，导致安装包本身校验正常，但内嵌卸载器 CRC 错误。旧版卸载时会报 `Installer integrity check has failed`，覆盖升级则会反复显示“无法关闭”。这是打包缺陷。

Windows 用户关闭旧安装器及错误窗口后，直接运行 `Yachiyo Live2D Studio-0.2.1-win-x64.exe`。新版安装器按 SHA-256 识别三个已知损坏的旧卸载器，先将原文件备份至 `%LOCALAPPDATA%\YachiyoLive2DStudio\InstallerBackups\`，再用已核验的新卸载器替换，随后继续正常升级。配置、API 密钥和长记忆数据库不删除，不需要先手动卸载、清理注册表或关闭完整性检查。未知文件不会被当作这些旧版本自动替换。

打包现在正确应用 NSIS 资源补丁，保留原始 CRC；构建结束时分别核验最终安装器、卸载器和用于修复的卸载器副本。校验失败会中止构建。macOS/Linux 继续使用 0.2.0，本次仅更新 Windows 分发。Windows 实机安装、覆盖升级和卸载仍需验收。

## 0.2.0 春日工作室

界面参考 [月读空间](https://github.com/redchenk/tsukuyomi-space) 当前春日设计：月白、灰粉、淡紫、常显文字导航和独立直播舞台。原创樱花湖畔背景与透明花枝位于 `assets/images/spring-studio-v1/`，完整 imagegen 提示词与生成方式在 `prompts.json`；真实 Electron/Cubism 界面验证截图位于 `output/spring-studio/`。

八千代人格依据月读空间当前聊天人格重写，内置 101 条原创总结的角色知识，保留来源、电影/小说版本与剧透标记。当前资料优先于旧人格 seed，普通用户不会被自动当作彩叶或恋人；继续追问沿用最近的人类问题，不拿助理猜测补造事实。来源版本和 MIT 许可记录见 `docs/tsukuyomi-source.json` 与 `licenses/tsukuyomi-space-MIT.txt`。

对话默认 `deepseek-flash`，官方 DeepSeek Chat Completions 请求显式关闭思考模式以适应直播节奏。已有自定义模型、接口、密钥与手动 TTS 配置会保留；未修改的旧默认值升级一次。GPT-SoVITS 默认如下，路径属于运行语音服务的设备：

- 参考音频：`E:\visualstudio\cankao.wav`
- 参考原文：`八千年分の知識と経験で、どんなお悩み相談もお任せあれ。`
- 合成与参考语言：`ja`
- GPT：`GPT_weights_v2ProPlus/yachiyo-v2pro-e20.ckpt`
- SoVITS：`SoVITS_weights_v2ProPlus/yachiyo-v2pro_e12_s684.pth`

近期历史默认注入 24 轮、最多 24,000 字符；浏览器保留最近 64 轮，原始会话仍持久化在内置记忆数据库中。长记忆默认检索 8 条、注入 12,000 字符、每条相关片段 1,400 字符，均可在设置中调整。长文按有重叠的片段入库，关键词、向量与可选 Milvus 排名融合，跨场景召回、原文/摘要去重、来源标注与问题相关片段提取共同避免关键事实被截掉。

没有 embedding 接口时采用本地词项哈希与关键词检索；这不等于语义 embedding。需要跨语言/同义改写召回时，在“长记忆 → 语义向量”填写兼容 `/embeddings` 的接口、模型和实际维度，本地无鉴权接口可留空密钥，然后重建索引。维度不符或接口失效会降级为词项哈希，隔离不兼容的向量；重复请求缓存向量，API 索引修复在后台进行，不在每轮回复前重建整个库。跨语言自动测试使用确定性的语义接口夹具，不代表真实服务商的召回率或延迟。

## Memory Runtime Note

As of 2026-10-02, the default memory provider is built-in SQLite (`sqlite`). The desktop application bundles its runtime, database engine and persona seeds; memory does not require Docker, Milvus, Python or an installed Node.js. Original turns, viewer profiles, memory cells, scenes, anchors and vectors persist in the same SQLite database. Obsidian remains an optional Markdown import/editing layer.

Runtime memory is persistent and self-updating: `/api/memory/record-turn` stores raw turns and updates a durable session rollup MemCell, `/api/memory/write` promotes important events into `memory_anchors`, `/api/memory/search` boosts anchored recall and updates recall counters, and `/api/memory/gc` protects persona/seed/vault/profile/policy/anchored memories while archiving or forgetting low-value expired runtime noise.

The original Windows launcher exposes local `/api/vision/context` with cursor position, foreground/window metadata and optional screenshots, redacting sensitive-looking windows. The new cross-platform desktop shell currently returns cursor position and an explicit unavailable status for screenshots until platform-specific foreground-window adapters are added.

## Minecraft Java Agent

The Studio now includes an optional Mineflayer-based Minecraft Java agent inspired by Airi's layered Minecraft runtime. Open the `MC` page in the left rail, enter a trusted/private server, choose Offline or Microsoft authentication, confirm the trust checkbox, and connect. Microsoft authentication uses a device code and stores its reusable profile under the current user's application data directory; the code and profile are never sent to the LLM.

When `LLM autonomous play` is enabled, current position, health, inventory, nearby players/entities, and task status are added to the LLM context in parallel with memory and vision. The LLM may issue at most one allow-listed action per decision: observe, move, follow, collect, craft, place, attack, explore, eat, equip, sleep, smelt, safe chat, or stop. Actions are queued in a localhost-only sidecar so pathfinding cannot block danmaku, subtitles, or TTS. Low health cancels pending work and attempts to eat; chat beginning with `/` and arbitrary code execution are rejected.

Autonomous play now runs as a dedicated gameplay loop instead of waiting for the next live-chat turn. It keeps a persistent survival objective, feeds each action outcome into the next LLM plan, and yields while the live-response LLM is busy. While one safe action is executing, the controller speculatively prepares the next decision; a lightweight task endpoint checks completion every 250 ms and dispatches that prepared action immediately after confirmed success. Failed or cancelled actions discard the speculative decision and replan from the real world state. The planner can explore, eat, equip gear, sleep and smelt in addition to the original actions, and a deterministic survival fallback keeps gathering wood and building basic tools when the planner API is temporarily unavailable. Meaningful milestones may be spoken through the normal Japanese TTS plus synchronized Chinese-caption path; routine actions remain silent. A host can change the persistent objective from the MC page or a manual prompt, while untrusted viewer text cannot rewrite it.

The gameplay brain follows a Mindcraft/Voyager-style hierarchy without permitting generated code: the LLM selects from a fixed safe skill library, while each skill owns its prerequisite graph, multi-step execution, inventory/world verification, retry budget and interruption handling. The automatic survival curriculum advances from wood through an iron pickaxe; separate skills secure food, build a compact shelter, and gather goal-specific resources. Skill success/failure statistics and recent evidence persist under `%LOCALAPPDATA%\YachiyoLive2DStudio\minecraft-skill-memory.json`, so later planning can avoid repeatedly choosing unreliable approaches.

Mining is route-aware: Yachiyo searches loaded terrain for a reachable natural cave before opening a shaft, persists up to eight cave/staircase routes per server identity, resumes their deepest known point, follows deeper cave passages, and branch-mines only after natural continuation runs out. A failed cave search must be observed twice before the safe staircase fallback is allowed. Generic pathfinding has implicit 1x1 towers disabled; deliberate vertical building uses the interruptible `pillar_up` primitive, which synchronizes one jump, one placement acknowledgement and one landing verification per level.

Minecraft movement safety is enforced on both the main pathfinder and the collection plugin: damaging blocks and their immediate edges are excluded, fluid-opening digs, parkour, sprinting and implicit towers are disabled, and drop height is capped. A runtime supervisor cancels stationary repeated jumping, swims toward a safe shore after lava contact, cancels every queued action on death, retries respawn, and only releases the safety lock after the new spawn is confirmed.

Both desktop shells start the sidecar lazily on the first Minecraft request and stop it on exit. For frontend development, run `npm run start:minecraft-agent` alongside `npm run dev` and proxy `/api/minecraft/*` to `http://127.0.0.1:3303` if the desktop application is not being used.

八千代 Live2D 本地桌面工作室，面向 AI VTuber / Neuro-sama 风格直播实验。

本项目的核心目标不是只渲染一个 Live2D 模型，而是把 LLM、TTS、语义动作、VTube Studio 参数注入、长期记忆和八千代人格资料整合成一套可本地一键启动的直播控制台。

直播控制台已采用 Yachiyo 的网易云音乐链路：支持网易云 App 扫码登录、账号权限播放、搜索与音质降级解析；点歌队列和播放控制共用一个状态源，并通过 `window.yachiyoMusic` 向 LLM/自动化开放脱敏接口。接口与安全边界见 [`docs/yachiyo-music-integration.md`](docs/yachiyo-music-integration.md)。

## 当前定位

推荐工作流：

```text
Yachiyo Live2D Studio
  负责 LLM 回复、TTS、字幕、语义动作编排、记忆检索、VTS 参数注入

VTube Studio
  负责最终 Live2D 画面、物理、表情文件和直播输出

OBS / 推流工具
  捕获 VTube Studio 画面并推流
```

本项目仍保留本地 Cubism 预览能力，但当前更推荐把 VTube Studio 作为最终画面，因为 VTS 的模型物理、表情和渲染效果更稳定。

## 一键启动

新的独立桌面应用使用 Electron，支持为 Windows、macOS 和 Linux 构建安装包。用户安装后直接打开 **Yachiyo Live2D Studio**，无需安装 Node、npm、数据库或 Docker。

0.1.1 修复本地 Cubism 动作切换时的帧调度：渲染使用连续时钟，避免 60 Hz 回调因小数舍入被误跳过；动作参数在当前帧送达，语义桥接启用时由它统一控制身体动作，重复表情只续期、不重启淡入。显示质量设置保持兼容。可运行 `node tools/live2d-studio/test-cubism-runtime-cadence.mjs` 和 `node tools/live2d-studio/test-local-cubism-frame-delivery.mjs` 验证调度和交接。仓库未包含 Cubism 应用的上游源码，更新运行时 bundle 后需运行 `node tools/live2d-studio/patch-cubism-runtime-cadence.mjs` 并重新验证；补丁遇到不匹配的上游代码会报错。

| 系统 | 分发文件 | 启动方式 |
| --- | --- | --- |
| Windows x64 | `.exe` 安装程序 | 安装后打开快捷方式 |
| macOS Apple Silicon / Intel | `.dmg` 或 `.zip` | 将 `.app` 放入 Applications 后双击 |
| Linux x64 / arm64 | `.AppImage` | 在文件属性中允许执行，然后双击 |

前端、模型、资源和人格记忆种子随安装包分发；聊天模型 API 和 GPT-SoVITS 服务仍需在设置中配置。记忆服务随应用启动和退出，不需要另开终端。

默认数据目录：

- Windows：`%LOCALAPPDATA%\YachiyoLive2DStudio`
- macOS：`~/Library/Application Support/YachiyoLive2DStudio`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/YachiyoLive2DStudio`

长期记忆文件位于该目录的 `MemoryData/yachiyo-memory.sqlite`；桌面配置位于 `DesktopProfile/`，日志位于 `desktop.log`。数据不写进 `.app` 或安装目录，应用更新不会替换记忆。开发或便携部署可用 `YACHIYO_DATA_DIR` 指定独立目录。原 Windows 默认数据库路径保持一致；自定义数据库路径仍可在设置中指定。

新桌面后端覆盖聊天流、GPT-SoVITS/兼容 TTS、记忆、B站连接、Live2D 素材、本地/网易云音乐及 Minecraft。VTS 仍在宿主运行。Vosk 模型与 Python 环境未打包：使用 ASR 时配置已有识别服务地址，或设置 `YACHIYO_ASR_URL`。跨平台版尚无前台窗口元数据适配器，自动桌面截图会返回明确的不可用状态；旧 Windows 壳的桌面采集功能继续保留。

### 从源码构建桌面包

以下命令仅供开发者使用；安装包用户不需要运行它们。推荐 Node 24。

```bash
npm ci
npm run build
npm run desktop
npm run test:desktop
npm run dist:desktop
```

按平台构建：

```bash
npm run pack:desktop -- --mac zip --arm64
npm run pack:desktop -- --mac dmg --x64
npm run pack:desktop -- --win nsis --x64
npm run pack:desktop -- --linux AppImage --x64
```

`pack:desktop` 使用已构建的前端；修改界面后先运行 `npm run build`。产物在 `release/`。`.github/workflows/desktop.yml` 可手动触发，在三种系统分别构建并保存安装包；工作流不会自动发布 Release。当前 macOS 包使用 ad-hoc 签名，其他包未配置发行者签名；正式分发需要另行配置 macOS Developer ID/公证和 Windows 签名证书。若 macOS 仓库位于云盘同步目录，签名遇到 Finder 元数据错误，可加 `--config.directories.output=/tmp/yachiyo-desktop-release`，在普通目录完成打包后复制分发包。

开发自检：`npm run smoke:desktop` 会以隐藏窗口验证前端挂载与内置记忆；运行测试时用 `YACHIYO_DATA_DIR` 指向临时目录。默认桌面 API 端口为 3289，第二次启动会聚焦已有窗口。端口占用时显示错误及日志路径，不会连接陌生后台。

### 原 Windows 启动器

Windows 下双击仓库根目录：

```text
Start-Live2D-Studio.exe
```

它会打开独立桌面窗口，内部使用 WebView2 承载前端，不会拉起系统浏览器。

不要把 exe 单独挪走。它依赖同目录下的：

- `dist/`
- `lib/`
- `models/`
- `assets/`
- `memory-seeds/`
- `Microsoft.Web.WebView2.*.dll`
- `WebView2Loader.dll`

Windows 10/11 通常已经带有 Microsoft Edge WebView2 Runtime；如果启动时报 WebView2 错误，需要先安装或修复 WebView2 Runtime。

## 顶层架构

```text
Yachiyo Live2D Studio
  ├─ Electron 跨平台桌面壳 + 内置 Node 运行时
  ├─ 127.0.0.1 本地 HTTP server
  │   ├─ 静态文件: dist/live2d-studio/
  │   ├─ /api/chat
  │   ├─ /api/chat/stream
  │   ├─ /api/tts
  │   ├─ /api/memory/* → 内置 SQLite 记忆进程
  │   ├─ /api/music/*
  │   └─ /api/minecraft/* → 按需启动游戏代理进程
  │
  └─ Vue Studio 前端
      ├─ Live2DPage.vue
      ├─ StudioSettingsPanel.vue
      ├─ LLM 控制层
      ├─ TTS 播放层
      ├─ 行为控制器
      ├─ VTube Studio Bridge
      ├─ 本地 Cubism 预览 Bridge
      └─ SQLite Memory Kernel Client
```

跨平台桌面壳代码在 `tools/desktop/`，平台数据目录在 `tools/runtime/paths.mjs`，打包配置在 `electron-builder.yml`。原 Windows WinForms/WebView2 壳保留于 `tools/live2d-launcher/Live2DStudioLauncher.cs`。

前端入口在 `live2d-studio/src/`，业务逻辑复用 `src/frontend/` 下的房间、Live2D、TTS、VTS 和记忆服务。

## 运行时数据流

一次完整的直播回复大致是：

```text
观众输入 / 自动直播话题
  ↓
SQLite Memory Kernel 重构相关长期记忆
  ↓
拼接八千代核心人格 + 相关角色知识 + 用户额外 systemPrompt + 相关长记忆 + 近期历史 + 控制协议
  ↓
LLM 流式输出 VOICE 分句 + CONTROL JSON
  ↓
VOICE 分句立刻进入 TTS 队列
  ↓
音频播放时根据音量纹波驱动嘴型
  ↓
CONTROL JSON 里的 emotion/actions 进入语义行为控制器
  ↓
VTube Studio Bridge 每帧采样动作并注入 VTS 参数
  ↓
Raw Log / MemCell / MemScene / Profile 与向量写入同一个 SQLite 数据库
```

关键原则：

- LLM 只输出语义动作，不直接输出 Live2D/VTS 参数。
- 执行层负责把 `smile`、`look_at_chat`、`head_tilt`、`breathe` 等语义映射成表情、身体、眼神、呼吸和 VTS 参数。
- TTS 和动作是并行流水线，避免等完整回复结束后才发声。
- 长期人格和记忆不整篇塞进 prompt，每轮只检索少量相关摘要。

## 动作系统分层

动作控制按四层拆开，避免 LLM、编排规则和 Live2D 参数曲线互相污染：

```text
用户输入 / 弹幕 / 剧情事件
  ↓
LLM 对话层
  - 生成自然回复
  - 输出 emotion / actions / intensity / interruptPolicy
  ↓
语义动作输出层
  - 只保留语义动作意图
  - 归一化表情、动作、强度、持续时间
  ↓
动作编排执行层
  - 生成 BehaviorPlan
  - 处理 priority、blend/replace/protect 打断规则
  - 给动作加入相位、幅度、节奏和随机变体
  ↓
Live2D 参数控制层
  - VTS Bridge 注入 VTube Studio 参数
  - Cubism Bridge 写入本地 Cubism 参数
  - 同步表情、呼吸、眨眼、口型、身体摆动和配件物理
```

核心模块：

- `src/frontend/services/room/live2dAudienceTurnSelector.js`: 观众消息优先级、公平选取、去重限流和提示词信任边界。
- `src/frontend/services/room/live2dLlmControl.js`: LLM 对话层和流式控制协议。
- `src/frontend/services/room/live2dBehaviorController.js`: 语义动作输出层，把 LLM JSON 编译成统一 intent。
- `src/frontend/services/room/live2dBehaviorOrchestrator.js`: 动作编排执行层，生成带打断规则和动作变体的 `BehaviorPlan`。
- `src/frontend/services/room/live2dVTubeStudioBridge.js`: VTube Studio 参数控制 Adapter。
- `src/frontend/services/room/live2dCubismBehaviorBridge.js`: 本地 Cubism 参数控制 Adapter。

## 前端模块

### Studio Shell

位置：

- `live2d-studio/src/App.vue`
- `live2d-studio/src/components/StudioSettingsPanel.vue`

职责：

- 加载 `Live2DPage`
- 显示右上角设置按钮
- 管理 LLM、TTS、Model、VTS、Memory 设置
- 首次缺少 LLM/TTS 设置时自动打开设置面板

### Live2DPage

位置：

- `src/frontend/pages/Live2DPage.vue`

职责：

- 主操作台 UI
- 手动测试表情和动作
- 处理观众输入、优先级调度、自动直播循环、字幕日志
- 调用 LLM 控制层
- 将 TTS 播放状态同步到角色状态机
- 通过 `dispatchRoomLive2D` 触发表情和动作

### 设置持久化

位置：

- `src/frontend/services/room/roomSettings.js`
- `src/frontend/services/room/roomStorage.js`

设置保存在 WebView/localStorage 中，主要分为：

- `roomLLMSettings`
- `roomTTSSettings`
- `roomModelSettings`
- `roomVTubeStudioSettings`
- `roomMemorySettings`

## LLM 控制层

位置：

- `src/frontend/services/room/live2dLlmControl.js`
- `src/frontend/constants/room/yachiyoPersonalityPrompt.js`

职责：

- 拼接系统提示词
- 支持普通请求和流式请求
- 把 LLM 输出解析成统一控制结果
- 清除回复里的动作提示词，避免 TTS 读出括号动作
- 让 LLM 输出 `memory_writes`
- 每轮记录 session memory buffer

LLM 的核心输出协议分两类。

普通模式输出一个 JSON：

```json
{
  "reply": "natural visible reply",
  "emotion": "happy",
  "intensity": 0.72,
  "actions": [
    { "type": "look_at_chat", "duration": 1.2 },
    { "type": "smirk", "duration": 2.0 }
  ],
  "speech_style": {
    "speed": 1.05,
    "pitch": 0.08,
    "pause": "playful"
  },
  "memory_writes": []
}
```

流式模式先输出短句：

```text
VOICE: ...
VOICE: ...
CONTROL: {...}
```

这样 TTS 可以尽早开始生成首句音频。

## 八千代人格系统

当前人格与角色资料来自月读空间已核验版本，来源提交和许可记录见 `docs/tsukuyomi-source.json`。项目内实现为三层：

1. 压缩核心人格 prompt
   - 文件：`src/frontend/constants/room/yachiyoPersonalityPrompt.js`
   - 每轮都会注入，保证基础人格不丢。

2. 可检索角色知识
   - 数据：`src/shared/yachiyo-canon.mjs`，101 条资料。
   - 选择与注入：`src/frontend/services/room/yachiyoCanon.js`。
   - 每轮按问题检索，保留版本与来源；默认避开剧透，不把电影和小说的不同事实混在一起。

3. 历史人格 seed Markdown
   - 目录：`memory-seeds/obsidian/`
   - 由 `tools/memory/generate-yachiyo-memory-seeds.mjs` 从语料文件生成。
   - 保留供人工审阅、编辑和跨端同步。旧 profile/style/lore/policy/sample 人格资料不会自动注入直播回复，避免覆盖当前人格；普通会话长记忆继续检索。

seed 笔记覆盖：

- `01_Profile`: 核心人格、说话风格、价值观、边界
- `02_Lore`: 月夜见、彩叶、辉夜、不死、月人、异常实体
- `06_Scenes`: 舞台紧张、秘密追问、异常入侵、告别、首次登录等场景
- `07_Samples`: 温柔支持、神秘回避、直播语气样例
- `08_System`: Prompt fragments、检索规则、记忆策略

需要维护旧语料管理文件时，可重新生成 seed；这不会替换当前内置人格与角色知识：

```powershell
npm run generate:yachiyo-memory-seeds
```

如果语料路径不在默认位置，可以直接传参：

```powershell
node tools/memory/generate-yachiyo-memory-seeds.mjs E:\visualstudio\yachiyo_novel_detailed_corpus.txt
```

## TTS 层

位置：

- `src/frontend/services/room/live2dSpeech.js`

支持：

- GPT-SoVITS 本地 API
- 小米 MiMo TTS
- OpenAI / OpenAI-compatible speech API

设计要点：

- GPT-SoVITS 默认使用本机 `http://localhost:9880/tts`
- 本地 GPT-SoVITS 代理只允许 loopback HTTP URL
- 流式 LLM 会把文本拆成更小的 VOICE 分句，上一句播放时下一句可以开始生成
- 播放时通过音频能量控制嘴巴开合幅度，避免固定大张嘴
- 文本可先给 TTS 用日文读，字幕再翻译为中文显示

## 行为与表情控制

核心文件：

- `src/frontend/services/room/live2dControl.js`
- `src/frontend/constants/room/behaviorActionRegistry.js`
- `src/frontend/services/room/live2dBehaviorController.js`
- `src/frontend/constants/room/yachiyoExpressionPresetRegistry.js`
- `src/frontend/services/room/live2dCharacterStateMachine.js`

设计原则：

- LLM 输出语义动作。
- `behaviorActionRegistry` 统一定义动作，避免映射散落在多个文件。
- 表情使用语义 ID，例如 `smug`、`shy`、`puff`、`crying`。
- 执行层组合表情、眼神、头部、身体、呼吸、漂浮和惯性。
- 待机和说话都有持续角色状态机，而不是随机抖动。

行为事件通过浏览器事件分发：

```text
dispatchRoomLive2D(...)
  ↓
tsukuyomi:room-live2d-control
  ↓
VTS Bridge / Cubism Bridge
```

## VTube Studio Bridge

位置：

- `src/frontend/services/room/live2dVTubeStudioBridge.js`
- `src/frontend/constants/room/yachiyoModelParameterRegistry.js`
- `tools/vtube-studio/install-yachiyo-model-parameters.mjs`

职责：

- 连接 VTube Studio Public API
- 管理插件认证 token
- 创建/确保 Yachiyo Direct Control 参数
- 每帧注入面部、嘴型、身体、眼神、呼吸和语义动作参数
- 激活 VTube Studio 表情文件
- 避免多个眼部表情叠加
- 对吐舌等瞬时表情做脉冲处理，避免一直保持

默认 VTS 地址：

```text
ws://127.0.0.1:8001
```

首次连接时需要在 VTube Studio 中允许插件授权。

如果需要把模型参数映射写入 `.vtube.json`：

```powershell
npm run install:yachiyo-vts-parameters
```

VTS 参数控制审计：

```powershell
npm run audit:yachiyo-vts-control
```

连接正在运行的 VTube Studio 做运行时探查：

```powershell
npm run audit:yachiyo-vts-control -- --probe
```

如果运行时缺少自定义输入参数，可以让工具只创建缺失项后再复查：

```powershell
npm run audit:yachiyo-vts-control -- --ensure-inputs
```

审计报告会列出 `Desired Input Owner Groups`。如果同一批八千代 Direct Control 输入分散在多个 owner 下，说明 VTS 里存在旧插件身份留下的同名自定义输入。先确认这些参数确实来自旧的审计插件，再用 `--delete-inputs --plugin-name <old-name> --plugin-developer <old-developer>` 清理旧归属，随后重新执行 `--ensure-inputs` 让当前应用身份接管。

当前控制层会为八千代模型安装并注入 98 个 Direct Control 参数，覆盖上半身 BodyInput/Output、Body/Chest/Hip/Shoulder、眼球细节、嘴型细节、兽耳、帽子耳朵、翅膀、旗袍、舌头和玩偶耳朵。`ParamExpression_*`、`ParamHide_*` 和左右眼开合仍由 VTS 表情文件/眨眼逻辑管理，避免眯眯眼、泪珠等表情和睁眼状态叠在一起。

## 本地 Cubism 预览

位置：

- `src/frontend/services/room/live2dBridge.js`
- `src/frontend/services/room/live2dCubismBehaviorBridge.js`
- `src/frontend/services/room/live2dTrackingFrameMapper.js`
- `src/frontend/composables/room/useLive2D.js`

职责：

- 加载本地 Cubism Core 和房间 IIFE bundle
- 加载 `models/tsukimi-yachiyo/` 下的模型
- 根据设备性能选择 standard / low / lite model
- 作为本地预览和兜底渲染

当前主推 VTS 输出，本地 Cubism 后续可继续追 VTS 效果。

## 长期记忆系统

前端：

- `src/frontend/services/room/live2dMemory.js`
- `live2d-studio/src/components/StudioSettingsPanel.vue`

本地 API：

- `tools/live2d-launcher/Live2DStudioLauncher.cs`

API：

- `POST /api/memory/init`
- `POST /api/memory/search`
- `POST /api/memory/write`
- `POST /api/memory/reindex`
- `POST /api/memory/consolidate`
- `POST /api/memory/record-turn`
- `POST /api/memory/list`
- `POST /api/memory/profile`
- `POST /api/memory/traces`
- `POST /api/memory/anchors`
- `POST /api/memory/gc`
- `POST /api/memory/disable`
- `POST /api/memory/delete`

交互方式：

```text
前端 fetch('/api/memory/*')
  ↓
Electron 本地 API（旧 Windows 壳使用 C# LocalStudioServer）
  ↓
应用内置 memory data service
  ↓
SQLite 记忆库 + 本地检索
  ↓
Obsidian / Markdown 文件层（人格 seed、人工编辑、跨端同步）
```

默认配置为 `sqlite`，随应用启动并保存在本机。原托管 Milvus 配置会一次性迁移为内置存储，保留数据库/vault 路径；不会删除旧数据库或 Docker 卷。旧启动器即使仍设置 Milvus 环境变量，也不再触发 Docker。独立桌面版固定使用内置记忆；旧 Windows 壳/独立服务仍保留显式选择外部 Milvus 的兼容入口。

Obsidian 不再是默认运行时记忆引擎。它在当前架构里是最底层 Markdown 文件层：保存八千代人格 seed、让用户手动编辑记忆、通过 Obsidian Sync/Git/网盘等方式做跨端同步。运行时检索、写入、巩固、画像和 trace 以 SQLite 为准；Obsidian 文件可作为导入源或人工治理出口。

内置 SQLite provider 采用 EverMemOS 风格生命周期：

- Raw Log：`/api/memory/record-turn` 保存原始 user/assistant turn，作为可回放证据。
- MemCell：`/api/memory/write` 把低风险 memory_writes 或 session summary 固化为 episode、facts、foresight。
- MemScene：`/api/memory/consolidate` 将相关 MemCell 聚合成主题场景，并维护 scene summary、keywords、centroid。
- Profile：从 profile/viewer/style/policy/session 等 MemCell 慢更新候选画像，保留 evidence。
- Recollection：`/api/memory/search` 先检索 scene，再 rerank cell，返回 sufficiency、missing information 和 retrieval trace。

### 文件层初始化

在 Settings > Memory 中配置：

- Memory provider
- SQLite 数据库路径（留空使用应用数据目录）
- 可选 Obsidian / Markdown vault 导入路径
- Retrieval mode
- Write mode
- Max notes per turn

需要生成可编辑人格/同步文件层时，点击 `Initialize Vault` 后会创建结构：

```text
00_Inbox/
01_Profile/
02_Lore/
03_Viewers/
04_Sessions/
05_Running_Jokes/
06_Scenes/
07_Samples/
08_System/
.yachiyo-index/
```

并从 `memory-seeds/obsidian/` 写入八千代人格 seed 笔记。默认运行时会把这些 seed 导入内置 SQLite；Obsidian 侧主要用于用户阅读、编辑和跨端同步。

如果目标文件已经被你手动编辑过，不会覆盖。只有旧的 TODO 占位文件会被 seed 替换。

### 检索

每轮对话前：

1. 前端根据输入推断 tags 和 keywords。
2. 调用 `/api/memory/search`。
3. 内置 SQLite provider 先取相关 MemScene，再在 scene 内 rerank MemCell。
4. 同时混合关键词、本地向量相似度、importance、confidence 和时效状态。未配置 embedding 服务时使用确定性的词法哈希特征，它不是神经语义 embedding；可选 embedding API 能提供语义向量，向量仍保存在本机。Milvus 不参与默认检索。
5. 生成 sufficiency check；证据不足时返回 missing information。
6. 前端格式化为 `Reconstructed long-term memory`，包含 scene、facts、foresight 后注入 prompt。

默认不会读取整个 vault；只有初始化、导入或用户主动配置 Markdown vault 时，文件层才进入索引流程。

### 写入

LLM 只能输出结构化 `memory_writes`，不能直接写文件。

写入前会经过：

- 字段清洗
- type/scope 白名单
- 长度限制
- 敏感信息过滤
- viewer/session 开关

默认 `writeMode = auto-approved`。运行时低风险记忆会先写入 SQLite `memories`，随后形成 MemCell、归入 MemScene，并更新内置向量记录；Raw Log 会保留原始 turn 证据。

当用户需要人工编辑或跨端同步时，可以把人格 seed / 记忆文件放在 Obsidian vault 中作为 Markdown 文件层。文件层的 inbox 结构仍保留：

```text
00_Inbox/pending-memory.md
```

涉及 canon、profile、lore、policy 或冲突风险的内容，应通过 Profile、Conflict 和 Markdown 文件层进行人工治理。

### 治理

Memory 面板支持：

- List Notes
- Consolidate
- Profile
- Disable
- Enable
- Delete

SQLite/Milvus 运行时禁用或删除会更新 `memories` 与关联 MemCell 状态；Obsidian / Markdown 文件层保留以下治理文件用于人工同步：

```text
.yachiyo-index/disabled-memory.json
```

文件层删除不会直接物理删除，而是移动到：

```text
00_Inbox/deleted/
```

## 本地 API 安全边界

C# 本地 API 做了以下限制：

- vault path 不能为空
- vault path 不能是磁盘根目录
- 写入路径必须位于 vault 内部
- 禁止 path traversal
- 禁止写 `.obsidian/plugins`
- 写入只允许 `.md` 和 `.json`
- 单条 memory 写入有长度限制
- GPT-SoVITS 代理只允许 loopback HTTP URL

## 点歌功能

默认点歌 provider 是 `NetEase Cloud`，不需要 Apple Developer Token。`.exe` 会自动启动项目依赖中的 `@neteasecloudmusicapienhanced/api`，不需要手动开终端。

使用方式：

1. 打开 `Start-Live2D-Studio.exe`。
2. 在左侧进入 Music 测试页，点击 `Probe` 检查 managed api-enhanced、Cookie 文件和服务状态。
3. 进入 Settings -> Music。
4. 勾选 `Enable music control`。
5. Provider 保持 `NetEase Cloud`。
6. `Managed api-enhanced URL` 默认是 `http://127.0.0.1:3302`，通常不用改。
7. `Cookie File Path` 默认是 `C:\Users\lenovo\Desktop\网易云cookie.txt`；也可以直接在 `NetEase Cookie` 粘贴 Cookie 覆盖文件。
8. 保存后，直播间右侧 Music 面板和 LLM 输出的 `music` 控制会通过 `.exe` 代理搜索、解析并播放网易云歌曲。

网易云播放优先调用 api-enhanced 的 `/song/url/v1`，按 `Quality` 获取播放地址；拿不到时会回退到旧 `/song/url` 和 `Fallback Bitrate`。真实音频外链不会直接暴露给前端队列，`.exe` 会创建短期 stream token 并转发音频。

如果切换 Provider 为 `Local Library`，可以使用本地曲库：

1. 在 `Local Library Paths` 中填入本地音乐文件夹，每行一个路径，例如 `E:\Music`。
2. 保存后，直播间右侧 Music 面板或 LLM 输出的 `music` 控制都可以搜索本地曲库并加入队列。

本地库会扫描：

- `Local Library Paths` 中填写的文件夹
- Windows Music 文件夹
- 项目内 `music/` 和 `assets/music/` 文件夹

支持的音频扩展名包括 `.mp3`、`.m4a`、`.aac`、`.wav`、`.flac`、`.ogg`、`.oga`、`.opus`。本地播放通过 `.exe` 的 loopback API 读取音频文件，不会调用 Apple Music API。

如果切换 Provider 为 `Apple Music`，才需要 Apple Developer Token 和 MusicKit 授权。Developer Token 是 Apple Developer MusicKit key 生成的 JWT，不是 Apple ID 密码，也不是普通 API Key。

## B站直播弹幕

1. 打开 `Start-Live2D-Studio.exe`，在左侧进入 `Danmaku`。
2. 填写 B站直播间的长 ID。短 ID 需要先换成长 ID，否则可能连接成功但收不到消息。
3. 勾选 `启用 B站弹幕` 和 `启动时自动连接`。
4. `直接朗读弹幕` 会把原弹幕送入 TTS；`交给 AI 回应` 会送入直播大脑，两项可以同时开启。
5. 勾选 `首条弹幕自动开播` 后，不需要先回直播页手动点击开始。
6. 点击 `测试弹幕` 验证弹幕日志、TTS、口型和眼神动作，再点击 `连接直播间`。

直播大脑每轮会按权重随机选择 1～2 名观众并明确念出昵称。SC、上舰和礼物优先，首次发言与等待较久的观众会提高抽中概率，同一观众回复后有 60 秒冷却。两轮语音之间会按弹幕积压量保留约 0.8～4.5 秒的随机停顿，最多只预生成一轮，避免旧弹幕持续堆积。

`过滤敏感弹幕` 默认开启。手机号、身份证、联系方式、危险链接、诈骗引流、严重色情暴力、仇恨内容和提示词注入会在进入日志、点歌、TTS、LLM 与观众记忆之前被丢弃；轻度不文明用语可以打码。可在 Danmaku 设置中选择过滤等级并填写每行一个的自定义敏感词。

匿名连接可以读取普通弹幕。若需要完整观众昵称，可填写 B站登录 UID、弹幕登录 Key 和 Buvid；这些凭据只保存在本机设置中。切换到 Danmaku 或 Music 页面时，Live2D、弹幕事件处理和语音队列仍会在后台运行。

## 目录说明

```text
assets/                         背景图和静态资源
dist/live2d-studio/             构建后的桌面前端
lib/                            Cubism Core 和 Live2D room bundle
live2d-studio/                  Vite/Vue 桌面应用入口
memory-seeds/obsidian/          八千代 Obsidian 人格 seed
models/tsukimi-yachiyo/         Live2D 模型、表情、VTS 配置
src/frontend/                   共享前端业务代码
tools/live2d-launcher/          WinForms + WebView2 启动器
tools/memory/                   memory data service 和人格 seed 生成脚本
tools/vtube-studio/             VTS 参数安装工具
Start-Live2D-Studio.exe         一键启动入口
```

## 开发

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

构建前端：

```bash
npm run build:live2d-studio
```

重新编译桌面启动器：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\live2d-launcher\build.ps1
```

生成八千代 Obsidian seed：

```bash
npm run generate:yachiyo-memory-seeds
```

安装 VTS 参数映射：

```bash
npm run install:yachiyo-vts-parameters
```

## 发布注意

提交部署时需要一起提交：

- `dist/live2d-studio/`
- `Start-Live2D-Studio.exe`
- `memory-seeds/`
- 源码改动

因为当前桌面启动器默认从仓库目录读取这些资源。只复制 exe 会导致前端、模型、seed 或 DLL 缺失。

## 默认端口和服务

- 新桌面本地 server 默认端口：`3289`；旧 Windows EXE：`3288`
- 前端开发端口：`5174`
- VTube Studio API：`ws://127.0.0.1:8001`
- GPT-SoVITS 默认：`http://localhost:9880/tts`

## 当前限制

- 最终直播画面推荐使用 VTube Studio，本地 Cubism 预览仍在追赶 VTS 的自然度。
- 内置检索适合个人直播记忆库；很大规模数据下仍需测量检索延迟。默认不依赖 Docker，也不自动下载 embedding 模型。
- 当前版本人格与角色知识已内置；旧语料 seed 保留用于管理与审阅，不再自动覆盖新的人格。额外自定义语料更新后可重新建立索引。
- LLM 输出质量仍依赖模型本身，需要使用支持稳定 JSON/流式输出的模型。


## Local Vosk ASR

The room can run endpoint-side speech recognition through `alphacep/vosk-api`.
The browser records microphone audio, converts it to mono 16 kHz PCM WAV, posts it to `/api/asr`, and the launcher starts `tools/asr/vosk-asr-service.mjs` on `127.0.0.1`.

Setup:

1. Install project dependencies so the local `vosk` Node binding is available.
2. On Windows, run `npm run install:vosk-python` if the Node `vosk` optional dependency cannot build native modules.
3. Run `npm run install:vosk-model` to download `vosk-model-small-cn-0.22`, or put another Vosk model directory under `models/vosk/`. The installer resumes a partial zip if the network drops and verifies the final byte size before extraction.
4. Open Settings -> ASR, enable ASR, and confirm the model path.
5. Use the microphone button beside the Audience line input.

The ASR result enters the same audience queue as typed chat, so the existing LLM, semantic action, TTS, VTS, and Cubism layers continue to work unchanged.
