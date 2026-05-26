# Yachiyo Live2D Studio

八千代 Live2D 本地测试项目，面向 AI VTuber / Neuro-sama 风格直播实验。

## 一键启动

在 Windows 上双击仓库根目录的 `Start-Live2D-Studio.exe`。

它会启动本地静态服务并打开：

```text
http://127.0.0.1:3288/live2d-studio/
```

保持控制台窗口打开；按 `Ctrl+C` 停止服务。不要把 exe 单独挪走，它需要同目录下的 `dist/`、`lib/`、`models/` 和 `assets/`。

## 开发模式

```bash
npm install
npm run dev
```

构建：

```bash
npm run build
```

## LLM / TTS 配置

当前页面读取浏览器 `localStorage` 中的 Room 设置。可以先在浏览器控制台写入示例配置：

```js
localStorage.setItem('roomLLMSettings', JSON.stringify({
  apiKey: 'YOUR_API_KEY',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  useProxy: false
}));

localStorage.setItem('roomTTSSettings', JSON.stringify({
  enabled: true,
  provider: 'gpt-sovits',
  apiUrl: 'http://localhost:9880/tts',
  useProxy: false,
  textLang: 'auto',
  promptLang: 'ja'
}));
```

刷新页面后使用 `LLM Act` 或 `Start`。
