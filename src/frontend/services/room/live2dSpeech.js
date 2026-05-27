import { readRoomLLMSettings, readRoomTTSSettings } from './roomSettings';
import { cleanLive2DReply } from './live2dText';

const DEFAULT_GPT_SOVITS_GPT_WEIGHT = 'GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt';
const DEFAULT_GPT_SOVITS_SOVITS_WEIGHT = 'SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth';

function defaultTtsUrl(provider) {
  return provider === 'gpt-sovits' ? 'http://localhost:9880/tts' : '';
}

function normalizeLocalGptSovitsUrl(url) {
  const parsed = new URL(url || defaultTtsUrl('gpt-sovits'));
  if (window.location.protocol === 'https:' && parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1') {
    parsed.hostname = 'localhost';
  }
  return parsed;
}

function normalizeGptSovitsLang(value, fallback = 'zh') {
  const raw = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const aliases = {
    cn: 'zh',
    'zh-cn': 'zh',
    chinese: 'zh',
    mandarin: 'zh',
    jp: 'ja',
    jpn: 'ja',
    japanese: 'ja',
    english: 'en',
    korean: 'ko',
    auto: 'auto'
  };
  const normalized = aliases[raw] || raw || fallback;
  return ['zh', 'ja', 'en', 'ko', 'yue', 'auto', 'all-zh', 'all-ja', 'all-yue', 'auto-yue'].includes(normalized)
    ? normalized.replace(/-/g, '_')
    : fallback;
}

function pickReply(data) {
  if (data?.output_text) return String(data.output_text || '').trim();
  if (Array.isArray(data?.output)) {
    return data.output
      .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
      .filter((block) => block?.type === 'output_text' || block?.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim();
  }
  if (Array.isArray(data?.content)) {
    return data.content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim();
  }
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.reply || '';
}

function normalizeOpenAIUrl(apiUrl = '') {
  const url = String(apiUrl || '').trim();
  if (/(api\.openai\.com|api\.x\.ai)\/v1\/?$/i.test(url)) return `${url.replace(/\/$/, '')}/responses`;
  if (/(xiaomimimo\.com|token-plan-cn\.xiaomimimo\.com)\/v1\/?$/i.test(url)) return `${url.replace(/\/$/, '')}/chat/completions`;
  return url;
}

function isOpenAIResponsesApi(apiUrl = '') {
  return /(api\.openai\.com|api\.x\.ai)\/v1\/responses\/?$/i.test(String(apiUrl || '').replace(/\/$/, ''));
}

function isOpenRouterApi(apiUrl = '') {
  return /openrouter\.ai\/api\/v1\/chat\/completions\/?$/i.test(String(apiUrl || '').replace(/\/$/, ''));
}

function isKimiChatTarget(apiUrl = '', modelName = '') {
  return /api\.moonshot\.cn|moonshot|kimi/i.test(`${apiUrl || ''} ${modelName || ''}`);
}

function openRouterHeaders(apiUrl = '') {
  if (!isOpenRouterApi(apiUrl)) return {};
  return {
    'HTTP-Referer': window.location.origin,
    'X-OpenRouter-Title': 'Yachiyo Live2D Studio'
  };
}

function detectTextLang(text) {
  const value = String(text || '');
  if (/[\u3040-\u30ff]/u.test(value)) return 'ja';
  if (/[\uac00-\ud7af]/u.test(value)) return 'ko';
  if (/[\u4e00-\u9fff]/u.test(value)) return 'zh';
  return 'en';
}

function compactSpeechText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .replace(/[,.!?;:'"()[\]{}<>\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u3010\u3011\u300a\u300b~\-]/g, '')
    .trim();
}

function cleanTtsText(text) {
  return cleanLive2DReply(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function japaneseTtsTranslatorPrompt() {
  return [
    '你是给 TTS 使用的日文翻译器。',
    '把用户提供的文本翻译成自然、适合朗读的日文。',
    '只输出日文正文，不要解释，不要 Markdown。',
    '不要输出括号里的动作提示、星号动作、舞台提示、表情提示、姿势描述、语气标签或旁白。',
    '如果原文里夹着动作、表情、姿势、语气或旁白提示，请彻底删除，只保留角色真正要说出口的话。',
    '保留昵称、专有名词和直播语气，让台词听起来像自然的日语 VTuber 发言。'
  ].join('\n');
}

async function translateForJapaneseTts(text) {
  const source = cleanTtsText(text);
  if (!source) return '';
  const settings = readRoomLLMSettings();
  if (!settings.apiKey || !settings.apiUrl) {
    throw new Error('请先在 Studio Settings 里配置 LLM，用于把 GPT-SoVITS 文本翻译成日文后再播放。');
  }

  const systemPrompt = japaneseTtsTranslatorPrompt();
  if (settings.useProxy) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: source,
        conversation: [],
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        model: settings.model,
        systemPrompt
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || `日文翻译失败：LLM ${response.status}`);
    return cleanTtsText(result.data?.reply || '');
  }

  const apiUrl = normalizeOpenAIUrl(settings.apiUrl);
  const model = settings.model || 'gpt-4o-mini';
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
      ...openRouterHeaders(apiUrl)
    },
    body: JSON.stringify(isOpenAIResponsesApi(apiUrl)
      ? {
          model: settings.model || 'gpt-5.5',
          instructions: systemPrompt,
          input: source,
          max_output_tokens: 240
        }
      : {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: source }
          ],
          temperature: isKimiChatTarget(apiUrl, model) ? 1 : 0.2,
          max_tokens: 240
        })
  });
  if (!response.ok) throw new Error(`日文翻译失败：LLM ${response.status}`);
  return cleanTtsText(pickReply(await response.json()));
}

function pickSplitMethod(text) {
  return compactSpeechText(text).length <= 4 ? 'cut0' : 'cut5';
}

function buildGptSovitsControlUrl(settings, pathname, params) {
  const url = normalizeLocalGptSovitsUrl(settings.apiUrl || defaultTtsUrl(settings.provider));
  url.pathname = pathname;
  url.search = '';
  Object.entries(params || {}).forEach(([key, value]) => {
    if (String(value || '').trim()) url.searchParams.set(key, String(value).trim());
  });
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

function requestLocalGptSovitsControl(url, timeout = 70000) {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve(false), timeout);
    const done = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    image.onload = done;
    image.onerror = done;
    image.src = url;
  });
}

async function ensureGptSovitsWeights(settings) {
  await requestLocalGptSovitsControl(buildGptSovitsControlUrl(settings, '/set_gpt_weights', {
    weights_path: settings.gptWeightPath || DEFAULT_GPT_SOVITS_GPT_WEIGHT
  }));
  await requestLocalGptSovitsControl(buildGptSovitsControlUrl(settings, '/set_sovits_weights', {
    weights_path: settings.sovitsWeightPath || DEFAULT_GPT_SOVITS_SOVITS_WEIGHT
  }));
}

function buildGptSovitsAudioUrl(text, settings) {
  const url = normalizeLocalGptSovitsUrl(settings.apiUrl || defaultTtsUrl(settings.provider));
  const speechText = String(text || '').trim() || 'OK.';
  const configuredLang = normalizeGptSovitsLang(settings.textLang || settings.model, 'auto');
  url.searchParams.set('text', speechText);
  url.searchParams.set('text_lang', configuredLang === 'auto' ? detectTextLang(speechText) : configuredLang);
  url.searchParams.set('ref_audio_path', settings.refAudioPath || settings.voice || '');
  url.searchParams.set('prompt_text', settings.promptText || '');
  url.searchParams.set('prompt_lang', normalizeGptSovitsLang(settings.promptLang, 'ja'));
  url.searchParams.set('text_split_method', pickSplitMethod(speechText));
  url.searchParams.set('batch_size', '1');
  url.searchParams.set('media_type', 'wav');
  url.searchParams.set('streaming_mode', 'false');
  url.searchParams.set('parallel_infer', 'true');
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

function dispatchMouth(value) {
  window.dispatchEvent(new CustomEvent('tsukuyomi:live2d-mouth', {
    detail: { value: Math.min(Math.max(Number(value) || 0, 0), 1) }
  }));
}

function stopAnimationFrame(id) {
  if (id) window.cancelAnimationFrame(id);
}

export function createLive2DSpeechPlayer({ onState } = {}) {
  let currentAudio = null;
  let objectUrl = '';
  let frameId = 0;
  let audioContext = null;
  let sourceNode = null;
  let analyser = null;

  function setState(patch) {
    onState?.(patch);
  }

  function stopMouth() {
    stopAnimationFrame(frameId);
    frameId = 0;
    dispatchMouth(0);
  }

  function stop() {
    stopMouth();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.onplay = null;
      currentAudio.onplaying = null;
      currentAudio.onwaiting = null;
      currentAudio.onpause = null;
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio = null;
    }
    sourceNode = null;
    analyser = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    setState({ status: 'idle', error: '' });
  }

  function startSyntheticMouth(text, audio) {
    const seed = Math.max(4, compactSpeechText(text).length);
    const tick = () => {
      if (!currentAudio || currentAudio !== audio || audio.paused || audio.ended) {
        stopMouth();
        return;
      }
      const t = audio.currentTime || 0;
      const pulse = Math.max(0, Math.sin(t * 18 + seed * 0.07));
      const accent = Math.max(0, Math.sin(t * 7.3 + seed * 0.13));
      dispatchMouth(Math.min(0.44, 0.02 + pulse * 0.3 + accent * 0.1));
      frameId = window.requestAnimationFrame(tick);
    };
    tick();
  }

  function startAnalysedMouth(text, audio) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        startSyntheticMouth(text, audio);
        return;
      }
      audioContext ||= new AudioContextClass();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode = audioContext.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioContext.destination);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let smoothedMouth = 0;
      const tick = () => {
        if (!currentAudio || currentAudio !== audio || audio.paused || audio.ended || !analyser) {
          stopMouth();
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const sample of data) {
          const centered = sample - 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length) / 128;
        const gated = Math.max(0, rms - 0.018);
        const target = Math.min(0.48, Math.pow(Math.min(gated / 0.18, 1), 0.72) * 0.48);
        smoothedMouth = smoothedMouth * 0.72 + target * 0.28;
        dispatchMouth(smoothedMouth < 0.025 ? 0 : smoothedMouth);
        frameId = window.requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {
      startSyntheticMouth(text, audio);
    }
  }

  async function createAnalysableAudioFromUrl(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`TTS ${response.status}`);
      objectUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(objectUrl);
      audio.dataset.mouthMode = 'analysed';
      return audio;
    } catch (_) {
      const audio = new Audio(url);
      audio.crossOrigin = 'anonymous';
      audio.dataset.mouthMode = 'analysed';
      return audio;
    }
  }

  async function makeAudio(text, settings) {
    const directLocalGptSovits = settings.provider === 'gpt-sovits' && !settings.useProxy;
    if (directLocalGptSovits) {
      const ttsText = await translateForJapaneseTts(text);
      if (!ttsText) throw new Error('日文翻译结果为空，已取消语音播放。');
      await ensureGptSovitsWeights(settings);
      const audio = await createAnalysableAudioFromUrl(buildGptSovitsAudioUrl(ttsText, {
        ...settings,
        textLang: 'ja',
        promptLang: settings.promptLang || 'ja'
      }));
      audio.dataset.speechText = ttsText;
      return audio;
    }

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...settings, text, textLang: settings.textLang || 'auto' })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || `TTS ${response.status}`);
    }
    objectUrl = URL.createObjectURL(await response.blob());
    return new Audio(objectUrl);
  }

  async function play(text, options = {}) {
    const speechText = cleanTtsText(text);
    if (!speechText) return;
    const settings = readRoomTTSSettings();
    if (!settings.enabled) {
      setState({ status: 'disabled', error: '' });
      return;
    }
    stop();
    setState({ status: 'loading', error: '' });
    try {
      const audio = await makeAudio(speechText, settings);
      currentAudio = audio;
      audio.preload = 'auto';
      let mouthStarted = false;
      const startMouth = () => {
        if (mouthStarted || currentAudio !== audio) return;
        mouthStarted = true;
        setState({ status: 'playing', error: '' });
        const mouthText = audio.dataset.speechText || speechText;
        const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.round(audio.duration * 1000)
          : 0;
        try {
          options.onStart?.({ audio, speechText, mouthText, durationMs });
        } catch (_) {
          // Keep speech playback alive even if a caller-side animation hook fails.
        }
        if (audio.dataset.mouthMode === 'synthetic') {
          startSyntheticMouth(mouthText, audio);
        } else {
          startAnalysedMouth(mouthText, audio);
        }
      };
      audio.onplay = () => {
        stopMouth();
        setState({ status: 'loading', error: '' });
      };
      audio.onplaying = startMouth;
      audio.onwaiting = () => {
        stopMouth();
        if (!audio.ended && currentAudio === audio) setState({ status: 'loading', error: '' });
      };
      audio.onpause = () => {
        if (!audio.ended && currentAudio === audio) stopMouth();
      };
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().catch(reject);
      });
      if (currentAudio === audio) stop();
    } catch (error) {
      stop();
      setState({ status: 'error', error: error.message || 'TTS failed' });
      throw error;
    }
  }

  function destroy() {
    stop();
    if (audioContext) {
      audioContext.close?.().catch(() => {});
      audioContext = null;
    }
  }

  return { play, stop, destroy };
}
