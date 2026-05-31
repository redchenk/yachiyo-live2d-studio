# Yachiyo Live2D Studio

八千代 Live2D 本地桌面工作室，面向 AI VTuber / Neuro-sama 风格直播实验。

本项目的核心目标不是只渲染一个 Live2D 模型，而是把 LLM、TTS、语义动作、VTube Studio 参数注入、长期记忆和八千代人格资料整合成一套可本地一键启动的直播控制台。

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
Start-Live2D-Studio.exe
  ├─ WinForms + WebView2 桌面壳
  ├─ 127.0.0.1 本地 HTTP server
  │   ├─ 静态文件: dist/live2d-studio/
  │   ├─ /api/chat
  │   ├─ /api/chat/stream
  │   ├─ /api/tts
  │   └─ /api/memory/*
  │
  └─ Vue Studio 前端
      ├─ Live2DPage.vue
      ├─ StudioSettingsPanel.vue
      ├─ LLM 控制层
      ├─ TTS 播放层
      ├─ 行为控制器
      ├─ VTube Studio Bridge
      ├─ 本地 Cubism 预览 Bridge
      └─ Obsidian Memory Client
```

桌面壳代码在 `tools/live2d-launcher/Live2DStudioLauncher.cs`。

前端入口在 `live2d-studio/src/`，业务逻辑复用 `src/frontend/` 下的房间、Live2D、TTS、VTS 和记忆服务。

## 运行时数据流

一次完整的直播回复大致是：

```text
观众输入 / 自动直播话题
  ↓
Obsidian Memory 检索相关长期记忆
  ↓
拼接八千代核心人格 + 用户额外 systemPrompt + 记忆摘要 + 控制协议
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
低风险 memory_writes 和 session summary 进入 Obsidian inbox
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
- 处理观众输入、自动直播循环、字幕日志
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

人格来源：

```text
E:\visualstudio\yachiyo_novel_detailed_corpus.txt
```

项目内实现为两层：

1. 压缩核心人格 prompt
   - 文件：`src/frontend/constants/room/yachiyoPersonalityPrompt.js`
   - 每轮都会注入，保证基础人格不丢。

2. Obsidian seed 长期记忆
   - 目录：`memory-seeds/obsidian/`
   - 由 `tools/memory/generate-yachiyo-memory-seeds.mjs` 从语料文件生成。
   - 初始化 vault 时复制到用户的 Obsidian vault。

seed 笔记覆盖：

- `01_Profile`: 核心人格、说话风格、价值观、边界
- `02_Lore`: 月夜见、彩叶、辉夜、不死、月人、异常实体
- `06_Scenes`: 舞台紧张、秘密追问、异常入侵、告别、首次登录等场景
- `07_Samples`: 温柔支持、神秘回避、直播语气样例
- `08_System`: Prompt fragments、检索规则、记忆策略

重新生成 seed：

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
- `POST /api/memory/disable`
- `POST /api/memory/delete`

交互方式：

```text
前端 fetch('/api/memory/*')
  ↓
C# LocalStudioServer
  ↓
托管 Node memory data service
  ↓
SQLite 记忆库 + 托管 Milvus 向量检索
```

默认配置为 `sqlite-milvus`：点开 `Start-Live2D-Studio.exe` 时，启动器会后台启动 memory data service，并请求项目托管的 `yachiyo-milvus-standalone` Docker 容器；如果 Docker Desktop 已安装但尚未运行，sidecar 会先尝试拉起 Docker Desktop。关闭启动器时会请求 sidecar 停止 Milvus 容器。首次启动需要本机 Docker 可用，并可能拉取 `milvusdb/milvus:latest` 镜像。

Obsidian 仍作为可选 provider 保留。选择 Obsidian 时，Obsidian 本身不需要提供 API，本项目直接读写 vault 里的 `.md` 和 `.json` 文件。

SQLite/Milvus provider 采用 EverMemOS 风格生命周期：

- Raw Log：`/api/memory/record-turn` 保存原始 user/assistant turn，作为可回放证据。
- MemCell：`/api/memory/write` 把低风险 memory_writes 或 session summary 固化为 episode、facts、foresight。
- MemScene：`/api/memory/consolidate` 将相关 MemCell 聚合成主题场景，并维护 scene summary、keywords、centroid。
- Profile：从 profile/viewer/style/policy/session 等 MemCell 慢更新候选画像，保留 evidence。
- Recollection：`/api/memory/search` 先检索 scene，再 rerank cell，返回 sufficiency、missing information 和 retrieval trace。

### Vault 初始化

在 Settings > Memory 中配置：

- Memory provider
- SQLite/Milvus 或 Obsidian 相关路径
- Retrieval mode
- Write mode
- Max notes per turn

点击 `Initialize Vault` 后会创建结构：

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

并从 `memory-seeds/obsidian/` 写入八千代人格 seed 笔记。

如果目标文件已经被你手动编辑过，不会覆盖。只有旧的 TODO 占位文件会被 seed 替换。

### 检索

每轮对话前：

1. 前端根据输入推断 tags 和 keywords。
2. 调用 `/api/memory/search`。
3. SQLite/Milvus provider 先取相关 MemScene，再在 scene 内 rerank MemCell。
4. 同时混合关键词、SQLite 向量、Milvus 向量、importance、confidence 和时效状态。
5. 生成 sufficiency check；证据不足时返回 missing information。
6. 前端格式化为 `Reconstructed long-term memory`，包含 scene、facts、foresight 后注入 prompt。

默认不会读取整个 vault。

### 写入

LLM 只能输出结构化 `memory_writes`，不能直接写文件。

写入前会经过：

- 字段清洗
- type/scope 白名单
- 长度限制
- 敏感信息过滤
- viewer/session 开关

默认 `writeMode = inbox-only`，会写入：

```text
00_Inbox/pending-memory.md
```

`auto-approved` 模式下，低风险内容可写入正式目录；涉及 canon、profile、lore、policy 或冲突风险的内容仍进入 `pending-review.md`。

### 治理

Memory 面板支持：

- List Notes
- Disable
- Enable
- Delete

禁用记录写入：

```text
.yachiyo-index/disabled-memory.json
```

删除不会直接物理删除，而是移动到：

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

- 桌面本地 server 默认端口：`3288`
- 前端开发端口：`5174`
- VTube Studio API：`ws://127.0.0.1:8001`
- GPT-SoVITS 默认：`http://localhost:9880/tts`

## 当前限制

- 最终直播画面推荐使用 VTube Studio，本地 Cubism 预览仍在追赶 VTS 的自然度。
- 托管 Milvus 依赖本机 Docker；首次运行可能需要启动 Docker Desktop 并下载 Milvus 镜像。
- 详细人格 seed 来自本地语料提炼文件，后续如果语料更新，需要重新生成 seed 并重新初始化或手动同步 vault。
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
