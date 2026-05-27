# Yachiyo Live2D Studio

八千代 Live2D 本地测试项目，面向 AI VTuber / Neuro-sama 风格直播实验。

## 一键启动

在 Windows 上双击仓库根目录的 `Start-Live2D-Studio.exe`。

它会打开一个独立桌面窗口，内部使用 WebView2 承载 Live2D Studio，不再拉起系统浏览器。

不要把 exe 单独挪走，它需要同目录下的 `dist/`、`lib/`、`models/`、`assets/` 以及 WebView2 相关 DLL。

## LLM / TTS 配置

启动应用后点击右上角齿轮按钮，在 Settings 面板里配置：

- `LLM`: API URL、API Key、模型名、额外系统提示词。
- `TTS`: GPT-SoVITS 本机 API，或 OpenAI 兼容语音 API。
- `Model`: 低质量模型开关。
- `VTS`: VTube Studio WebSocket 输出。默认使用 `ws://127.0.0.1:8001`，首次连接时在 VTube Studio 里允许插件授权。

配置会保存在当前应用本地存储里，Live2D 的 `LLM Act`、`Start`、`Voice` 会直接读取这些设置。

当前推荐工作流是 VTube Studio 作为最终直播画面，Yachiyo Live2D Studio 负责 LLM、TTS、直播编导和参数注入；内置 Live2D 画面只作为本地预览和兜底。

## 开发模式

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

重新编译桌面启动器：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\live2d-launcher\build.ps1
```

Windows 需要已安装 Microsoft Edge WebView2 Runtime。Windows 10/11 通常已经自带。
