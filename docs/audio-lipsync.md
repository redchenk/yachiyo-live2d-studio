# 音频口型（0.2.6）

讲话和唱歌都在本机分析实际声音，不根据文字编造口型，不调用 LLM，也不要求安装 VTube Studio / Unity。

- 讲话：GPT-SoVITS 保留流式播放；本机同源中转避免跨域音频被 Web Audio 静音。短期单次 token 由本机 JSON POST 创建，不在播放 URL 中暴露文本或服务参数。其他 TTS 的音频 Blob 也进入同一个分析器。
- 分析：16 kHz、1024 点窗口、26 个 Mel 滤波器、12 个 MFCC；元音模板相似度归一化。开合使用对数音量和静音门限，另有呼吸/噪声模板。音量按声道独立测量，避免左右反相消除。
- 唱歌：只分析用户关联的纯人声，后台 Worker 生成 10 ms 音量 / 20 ms 元音缓存。播放时跟随歌曲 currentTime；暂停、缓冲、拖动和停止闭嘴。没有纯人声时保持闭嘴。混音音量不驱动口型。
- 模型：八千代现有模型没有独立 A/I/U/E/O 形变，使用 MouthPuckerWiden、MouthFunnel、JawOpen 和 MouthOpenY 表达差异。音频优先于随机动作的嘴部参数，保留表情的 MouthForm。只平滑一次，避免多层动画平滑造成口型拖后。
- 旧数据：v1 音量缓存继续可用；重新关联原纯人声文件生成 v2 元音缓存。设置和歌曲副本保留。纯人声音频不会重复播放，也不会上传外部服务。

## 调整入口

唱歌模式 → 右侧歌单 → 展开「讲话与唱歌口型校准」。讲话可调灵敏度、静音门限和额外延后（0–250 ms）；歌曲仍按每首设置 ±5000 ms 偏移和静音门限。若声卡输出延迟较大，增加讲话延后；流式声音不能预测尚未生成的音频，因此不提供负延后。

通用女声模板可直接用，但不保证适配每种音色。准备当前 GPT-SoVITS/RVC 音色的 A「あ」、I「い」、U「う」、E「え」、O「お」各一个干净片段（0.15–10 秒、最大 16 MB，无伴奏），依次选择对应按钮导入。呼吸声用真实气声片段；全静音无法提供声学特征。可恢复通用女声。讲话即时应用；已经保存的歌曲须重新关联人声才能重新分析。高音、假声及不同说话/歌唱音色仍可能需要不同的校准片段。

这不是语音转写或强制音素对齐，也不自动分离混音。伴奏泄漏需要更干净的人声轨或提高门限。模型缺少专用元音形变时，嘴型精度受模型本身限制。

## 参考与许可

参考 [VTube Studio Lipsync](https://github.com/DenchiSoft/VTubeStudio/wiki/Lipsync) 的音量、元音、静音与校准设计。
MFCC 管线与通用女声模板改编自 [hecomi/uLipSync](https://github.com/hecomi/uLipSync/tree/060587907655235dba86dc7052d0b395c8ecd840)，固定版本 `060587907655235dba86dc7052d0b395c8ecd840`：`Runtime/Core/Algorithm.cs`、`LipSyncJob.cs`、`Assets/Profiles/uLipSync-Profile-Sample-Female.asset`。模板按各类 16 帧取平均。MIT 许可证随包附在 `licenses/uLipSync-MIT.txt`；并未引入 Unity 运行时或角色素材。

## 验证范围

`tools/desktop/tests/lipsync.test.mjs` 验证声学特征、模板匹配、门限、帧率无关平滑、旧缓存、数据上限以及流式中转与取消；`tools/desktop/verify-lipsync.mjs` 在真实 Electron 音频/Cubism 中验证合成且已校准的五元音、反相立体声、静音、流式 TTS、实际模型参数、导入 Worker、校准 UI 和歌曲间奏。合成测试不能作为实际 GPT-SoVITS/RVC 音色的准确率。Windows/Linux 和真实音色的听看验收仍需在目标设备进行。
