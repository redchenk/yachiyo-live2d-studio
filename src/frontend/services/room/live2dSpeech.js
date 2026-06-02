import { normalizeLLMApiUrl, readRoomLLMSettings, readRoomTTSSettings } from './roomSettings';
import { cleanLive2DReply } from './live2dText';

const DEFAULT_GPT_SOVITS_GPT_WEIGHT = 'GPT_weights_v2ProPlus/yachiyo-v2pro-e15.ckpt';
const DEFAULT_GPT_SOVITS_SOVITS_WEIGHT = 'SoVITS_weights_v2ProPlus/yachiyo-v2pro_e8_s456.pth';
const MAX_TTS_PREFETCH = 4;
const LLM_TRANSLATION_TIMEOUT_MS = 45000;
const TTS_FETCH_TIMEOUT_MS = 90000;
const AUDIO_STALL_TIMEOUT_MS = 12000;
const AUDIO_PLAYBACK_GRACE_MS = 18000;
const AUDIO_MIN_PLAYBACK_TIMEOUT_MS = 30000;
const AUDIO_MAX_PLAYBACK_TIMEOUT_MS = 180000;
const TTS_EMOTION_GUIDES = {
  happy: 'bright, smiling, lively',
  smile: 'warm, gentle, smiling',
  smug: 'playful, teasing, confident',
  shy: 'soft, bashful, slightly embarrassed',
  surprised: 'quick, amazed, curious',
  angry: 'firm, cute-annoyed, energetic',
  puff: 'pouting, cute-annoyed, stubborn',
  tongue: 'playful, cheeky, teasing',
  dizzy: 'confused, wobbly, uncertain',
  sad: 'quiet, tender, a little sad',
  crying: 'tearful, fragile, emotional',
  fire: 'energetic, determined, intense',
  neutral: 'natural, conversational'
};
let gptSovitsWeightsSignature = '';
let gptSovitsWeightsPromise = null;

function timeoutError(message) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

async function fetchWithTimeout(resource, options = {}, timeoutMs = TTS_FETCH_TIMEOUT_MS, label = 'Request') {
  const AbortControllerClass = globalThis.AbortController;
  if (!AbortControllerClass) return fetch(resource, options);
  const controller = new AbortControllerClass();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, {
      ...options,
      signal: options.signal || controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw timeoutError(`${label} timed out`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function defaultTtsUrl(provider) {
  return provider === 'gpt-sovits' ? 'http://localhost:9880/tts' : '';
}

function isDirectLocalGptSovits(settings = {}) {
  return settings.provider === 'gpt-sovits' && !settings.useProxy;
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

function normalizeOpenAIUrl(apiUrl = '', model = '', provider = '') {
  return normalizeLLMApiUrl(apiUrl, model, provider);
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

function estimateSpeechDurationMs(text) {
  const length = compactSpeechText(text).length;
  return clampNumber(length * 190 + 1400, 2600, AUDIO_MAX_PLAYBACK_TIMEOUT_MS - AUDIO_PLAYBACK_GRACE_MS);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(Math.max(numeric, min), max);
}

function playbackTimeoutMs(audio, text) {
  const durationMs = Number.isFinite(audio?.duration) && audio.duration > 0
    ? audio.duration * 1000
    : estimateSpeechDurationMs(text);
  return clampNumber(durationMs + AUDIO_PLAYBACK_GRACE_MS, AUDIO_MIN_PLAYBACK_TIMEOUT_MS, AUDIO_MAX_PLAYBACK_TIMEOUT_MS);
}

function cleanTtsText(text) {
  return cleanLive2DReply(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function legacyJapaneseTtsTranslatorPrompt() {
  return [
    '你是给 TTS 使用的日文翻译器。',
    '把用户提供的文本翻译成自然、适合朗读的日文。',
    '只输出日文正文，不要解释，不要 Markdown。',
    '不要输出括号里的动作提示、星号动作、舞台提示、表情提示、姿势描述、语气标签或旁白。',
    '如果原文里夹着动作、表情、姿势、语气或旁白提示，请彻底删除，只保留角色真正要说出口的话。',
    '保留昵称、专有名词和直播语气，让台词听起来像自然的日语 VTuber 发言。'
  ].join('\n');
}

function normalizeTtsEmotion(value) {
  const token = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (token === 'namida') return 'sad';
  if (token === 'tears') return 'crying';
  if (token === 'smile') return 'happy';
  return TTS_EMOTION_GUIDES[token] ? token : 'neutral';
}

function ttsEmotionGuide(options = {}) {
  const emotion = normalizeTtsEmotion(options.emotion);
  const style = options.speechStyle && typeof options.speechStyle === 'object' ? options.speechStyle : {};
  return [
    `Emotion: ${emotion}.`,
    `Delivery: ${TTS_EMOTION_GUIDES[emotion] || TTS_EMOTION_GUIDES.neutral}.`,
    style.pause ? `Timing: ${String(style.pause).trim()}.` : '',
    Number.isFinite(Number(style.speed)) ? `Relative speed: ${Number(style.speed).toFixed(2)}.` : '',
    Number.isFinite(Number(style.pitch)) ? `Relative pitch: ${Number(style.pitch).toFixed(2)}.` : ''
  ].filter(Boolean).join(' ');
}

function japaneseTtsTranslatorPrompt(options = {}) {
  return [
    'You are a Japanese line adapter for TTS.',
    'Translate the user-provided spoken line into natural Japanese that is easy to read aloud.',
    'Output only the Japanese spoken line. Do not use Markdown or explanations.',
    'Remove all parenthesized action hints, asterisk actions, stage directions, emotion labels, pose descriptions, and asides.',
    'Keep names, VTuber flavor, and the intended emotional delivery.',
    ttsEmotionGuide(options)
  ].join('\n');
}

async function translateForJapaneseTts(text, options = {}) {
  const source = cleanTtsText(text);
  if (!source) return '';
  if (detectTextLang(source) === 'ja') return source;
  const settings = readRoomLLMSettings();
  if (!settings.apiKey || !settings.apiUrl) {
    throw new Error('请先在 Studio Settings 里配置 LLM，用于把 GPT-SoVITS 文本翻译成日文后再播放。');
  }

  const systemPrompt = japaneseTtsTranslatorPrompt(options);
  if (settings.useProxy) {
    const response = await fetchWithTimeout('/api/chat', {
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
    }, LLM_TRANSLATION_TIMEOUT_MS, 'Japanese TTS translation');
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || `日文翻译失败：LLM ${response.status}`);
    return cleanTtsText(result.data?.reply || '');
  }

  const model = settings.model || 'gpt-4o-mini';
  const apiUrl = normalizeOpenAIUrl(settings.apiUrl, model, settings.provider);
  const response = await fetchWithTimeout(apiUrl, {
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
  }, LLM_TRANSLATION_TIMEOUT_MS, 'Japanese TTS translation');
  if (!response.ok) throw new Error(`日文翻译失败：LLM ${response.status}`);
  return cleanTtsText(pickReply(await response.json()));
}

function pickSplitMethod(text) {
  return compactSpeechText(text).length <= 42 ? 'cut0' : 'cut5';
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

function gptSovitsWeightSignature(settings) {
  const url = normalizeLocalGptSovitsUrl(settings.apiUrl || defaultTtsUrl(settings.provider));
  return [
    url.origin,
    settings.gptWeightPath || DEFAULT_GPT_SOVITS_GPT_WEIGHT,
    settings.sovitsWeightPath || DEFAULT_GPT_SOVITS_SOVITS_WEIGHT
  ].join('|');
}

async function ensureGptSovitsWeights(settings) {
  const signature = gptSovitsWeightSignature(settings);
  if (gptSovitsWeightsSignature === signature && gptSovitsWeightsPromise) {
    await gptSovitsWeightsPromise;
    return;
  }

  gptSovitsWeightsSignature = signature;
  gptSovitsWeightsPromise = (async () => {
    await requestLocalGptSovitsControl(buildGptSovitsControlUrl(settings, '/set_gpt_weights', {
      weights_path: settings.gptWeightPath || DEFAULT_GPT_SOVITS_GPT_WEIGHT
    }));
    await requestLocalGptSovitsControl(buildGptSovitsControlUrl(settings, '/set_sovits_weights', {
      weights_path: settings.sovitsWeightPath || DEFAULT_GPT_SOVITS_SOVITS_WEIGHT
    }));
  })().catch((error) => {
    if (gptSovitsWeightsSignature === signature) {
      gptSovitsWeightsSignature = '';
      gptSovitsWeightsPromise = null;
    }
    throw error;
  });
  await gptSovitsWeightsPromise;
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
  url.searchParams.set('streaming_mode', 'true');
  url.searchParams.set('parallel_infer', 'false');
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
  let frameId = 0;
  let audioContext = null;
  let currentReject = null;
  let queueToken = 0;
  let queueRunning = false;
  const speechQueue = [];
  const audioEnvelopes = new WeakMap();

  function setState(patch) {
    onState?.(patch);
  }

  function stopMouth() {
    stopAnimationFrame(frameId);
    frameId = 0;
    dispatchMouth(0);
  }

  function makeStopError() {
    const error = new Error('Speech stopped');
    error.name = 'AbortError';
    return error;
  }

  function isStopError(error) {
    return error?.name === 'AbortError';
  }

  function releaseAudio(audio) {
    const url = audio?.dataset?.objectUrl || '';
    if (url) {
      URL.revokeObjectURL(url);
      audio.dataset.objectUrl = '';
    }
  }

  function clearCurrentAudio() {
    stopMouth();
    if (currentAudio) {
      const audio = currentAudio;
      currentAudio.pause();
      audio.onplay = null;
      audio.onplaying = null;
      audio.onwaiting = null;
      audio.onstalled = null;
      audio.onabort = null;
      audio.oncanplay = null;
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onpause = null;
      audio.onended = null;
      audio.onerror = null;
      currentAudio = null;
      releaseAudio(audio);
    }
    currentReject = null;
  }

  function rejectQueued(error = makeStopError()) {
    while (speechQueue.length) {
      const item = speechQueue.shift();
      if (item.audio) releaseAudio(item.audio);
      item.reject(error);
    }
  }

  function stop() {
    queueToken += 1;
    rejectQueued();
    if (currentReject) currentReject(makeStopError());
    clearCurrentAudio();
    setState({ status: 'idle', error: '' });
  }

  function startSyntheticMouth(text, audio) {
    const seed = Math.max(4, compactSpeechText(text).length);
    const tick = () => {
      if (!currentAudio || currentAudio !== audio || audio.paused || audio.ended) {
        stopMouth();
        return;
      }
      if (audioEnvelopes.get(audio)?.values?.length) {
        startEnvelopeMouth(text, audio);
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

  function startEnvelopeMouth(text, audio) {
    const envelope = audioEnvelopes.get(audio);
    if (!envelope?.values?.length) {
      startSyntheticMouth(text, audio);
      return;
    }
    let smoothedMouth = 0;
    const tick = () => {
      if (!currentAudio || currentAudio !== audio || audio.paused || audio.ended) {
        stopMouth();
        return;
      }
      const index = Math.min(
        envelope.values.length - 1,
        Math.max(0, Math.floor((audio.currentTime || 0) * envelope.fps))
      );
      const target = envelope.values[index] || 0;
      smoothedMouth = smoothedMouth * 0.58 + target * 0.42;
      dispatchMouth(smoothedMouth < 0.025 ? 0 : smoothedMouth);
      frameId = window.requestAnimationFrame(tick);
    };
    tick();
  }

  async function buildMouthEnvelope(blob) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioContext ||= new AudioContextClass();
      const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
      const fps = 60;
      const channel = decoded.getChannelData(0);
      const sampleRate = decoded.sampleRate || 44100;
      const hopSize = Math.max(1, Math.floor(sampleRate / fps));
      const windowSize = Math.max(hopSize, Math.floor(sampleRate * 0.032));
      const raw = [];
      for (let start = 0; start < channel.length; start += hopSize) {
        let sum = 0;
        let count = 0;
        const end = Math.min(channel.length, start + windowSize);
        for (let index = start; index < end; index += 1) {
          const sample = channel[index] || 0;
          sum += sample * sample;
          count += 1;
        }
        raw.push(Math.sqrt(sum / Math.max(count, 1)));
      }
      const sorted = [...raw].sort((left, right) => left - right);
      const reference = Math.max(sorted[Math.floor(sorted.length * 0.92)] || 0, 0.035);
      return {
        fps,
        values: raw.map((value) => {
          const gated = Math.max(0, value - 0.01);
          return Math.min(0.48, Math.pow(Math.min(gated / reference, 1), 0.74) * 0.48);
        })
      };
    } catch (_) {
      return null;
    }
  }

  async function createAudioFromBlob(blob) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.dataset.objectUrl = url;
    audio.dataset.mouthMode = 'synthetic';
    buildMouthEnvelope(blob)
      .then((envelope) => {
        if (!envelope?.values?.length || !audio.dataset.objectUrl) return;
        audioEnvelopes.set(audio, envelope);
        audio.dataset.mouthMode = 'envelope';
      })
      .catch(() => {});
    return audio;
  }

  function createFastAudioFromUrl(url, speechText = '') {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.dataset.mouthMode = 'synthetic';
    audio.dataset.fastStart = 'true';
    audio.dataset.speechText = speechText;
    audio.load?.();
    return audio;
  }

  async function createAnalysableAudioFromUrl(url) {
    try {
      const response = await fetchWithTimeout(url, {}, TTS_FETCH_TIMEOUT_MS, 'TTS audio fetch');
      if (!response.ok) throw new Error(`TTS ${response.status}`);
      return createAudioFromBlob(await response.blob());
    } catch (_) {
      const audio = new Audio(url);
      audio.dataset.mouthMode = 'synthetic';
      return audio;
    }
  }

  async function makeAudio(text, settings, options = {}) {
    const directLocalGptSovits = isDirectLocalGptSovits(settings);
    if (directLocalGptSovits) {
      const ttsText = await translateForJapaneseTts(text, options);
      if (!ttsText) throw new Error('日文翻译结果为空，已取消语音播放。');
      await ensureGptSovitsWeights(settings);
      const audio = createFastAudioFromUrl(buildGptSovitsAudioUrl(ttsText, {
        ...settings,
        textLang: 'ja',
        promptLang: settings.promptLang || 'ja'
      }), ttsText);
      audio.dataset.speechText = ttsText;
      return audio;
    }

    const response = await fetchWithTimeout('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...settings,
        text,
        textLang: settings.textLang || 'auto',
        emotion: normalizeTtsEmotion(options.emotion),
        speechStyle: options.speechStyle || null
      })
    }, TTS_FETCH_TIMEOUT_MS, 'TTS synthesis');
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || `TTS ${response.status}`);
    }
    return createAudioFromBlob(await response.blob());
  }

  function prepareQueueItem(item, token, options = {}) {
    if (item.audioPromise) return item.audioPromise;
    const settings = readRoomTTSSettings();
    if (!settings.enabled) {
      item.audioPromise = Promise.resolve(null);
      return item.audioPromise;
    }
    if (options.notifyLoading) {
      setState({ status: 'loading', error: '' });
    }
    item.audioPromise = makeAudio(item.text, settings, item.options)
      .then((audio) => {
        if (token !== queueToken) {
          releaseAudio(audio);
          throw makeStopError();
        }
        item.audio = audio;
        return audio;
      });
    return item.audioPromise;
  }

  function preloadQueuedAudio(token, options = {}) {
    if (token !== queueToken) return;
    const settings = readRoomTTSSettings();
    const directLocalGptSovits = isDirectLocalGptSovits(settings);
    const playbackActive = currentAudio && !currentAudio.paused && !currentAudio.ended;
    if (directLocalGptSovits && !options.afterPlaybackStart && !playbackActive) return;
    const preparedCount = speechQueue.filter((item) => item.audioPromise).length;
    const maxPrefetch = directLocalGptSovits ? 1 : MAX_TTS_PREFETCH;
    const budget = Math.max(0, maxPrefetch - preparedCount);
    if (!budget) return;
    speechQueue
      .filter((item) => !item.audioPromise)
      .slice(0, budget)
      .forEach((item) => {
        prepareQueueItem(item, token).catch(() => {});
      });
  }

  async function playInternal(text, options = {}, token = queueToken, preparedAudioPromise = null, onPlaybackStart = null) {
    const speechText = cleanTtsText(text);
    if (!speechText) return false;
    const settings = readRoomTTSSettings();
    if (!settings.enabled) {
      setState({ status: 'disabled', error: '' });
      return false;
    }
    setState({ status: 'loading', error: '' });
    try {
      const audio = preparedAudioPromise
        ? await preparedAudioPromise
        : await makeAudio(speechText, settings, options);
      if (!audio) return false;
      if (token !== queueToken) throw makeStopError();
      currentAudio = audio;
      audio.preload = 'auto';
      let playbackStarted = false;
      let mouthLoopStarted = false;
      const startMouth = () => {
        if (currentAudio !== audio || audio.ended) return;
        setState({ status: 'playing', error: '' });
        const mouthText = audio.dataset.speechText || speechText;
        if (!playbackStarted) {
          playbackStarted = true;
          const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
            ? Math.round(audio.duration * 1000)
            : 0;
          try {
            options.onStart?.({ audio, speechText, mouthText, durationMs });
          } catch (_) {
            // Keep speech playback alive even if a caller-side animation hook fails.
          }
          try {
            onPlaybackStart?.();
          } catch (_) {
            // Queue preloading is best-effort and should not interrupt speech.
          }
        }
        if (mouthLoopStarted) return;
        mouthLoopStarted = true;
        if (audio.dataset.mouthMode === 'envelope') startEnvelopeMouth(mouthText, audio);
        else startSyntheticMouth(mouthText, audio);
      };
      await new Promise((resolve, reject) => {
        let settled = false;
        let playbackTimer = 0;
        let stallTimer = 0;

        const cleanupWatchdogs = () => {
          if (playbackTimer) window.clearTimeout(playbackTimer);
          if (stallTimer) window.clearTimeout(stallTimer);
          playbackTimer = 0;
          stallTimer = 0;
        };
        const settle = (callback) => {
          if (settled) return;
          settled = true;
          cleanupWatchdogs();
          callback();
        };
        const fail = (error) => settle(() => reject(error));
        const finish = () => settle(resolve);
        const resetPlaybackWatchdog = () => {
          if (settled) return;
          if (playbackTimer) window.clearTimeout(playbackTimer);
          playbackTimer = window.setTimeout(() => {
            if (currentAudio === audio && !audio.ended) {
              fail(timeoutError('Audio playback timed out'));
            }
          }, playbackTimeoutMs(audio, audio.dataset.speechText || speechText));
        };
        const armStallWatchdog = () => {
          if (settled) return;
          if (stallTimer) window.clearTimeout(stallTimer);
          stallTimer = window.setTimeout(() => {
            if (currentAudio === audio && !audio.ended) {
              fail(timeoutError('Audio playback stalled'));
            }
          }, AUDIO_STALL_TIMEOUT_MS);
        };

        currentReject = fail;
        resetPlaybackWatchdog();
        audio.onplay = () => {
          if (!playbackStarted) {
            stopMouth();
            mouthLoopStarted = false;
            setState({ status: 'loading', error: '' });
          }
        };
        audio.onplaying = () => {
          startMouth();
          armStallWatchdog();
        };
        audio.oncanplay = () => {
          if (!playbackStarted && currentAudio === audio) setState({ status: 'loading', error: '' });
        };
        audio.onloadedmetadata = resetPlaybackWatchdog;
        audio.ontimeupdate = armStallWatchdog;
        audio.onwaiting = () => {
          stopMouth();
          mouthLoopStarted = false;
          if (!audio.ended && currentAudio === audio) {
            setState({ status: 'loading', error: '' });
            if (playbackStarted) armStallWatchdog();
          }
        };
        audio.onstalled = () => {
          if (playbackStarted && !audio.ended && currentAudio === audio) armStallWatchdog();
        };
        audio.onpause = () => {
          if (!audio.ended && currentAudio === audio) {
            stopMouth();
            mouthLoopStarted = false;
          }
        };
        audio.onabort = () => fail(makeStopError());
        audio.onended = finish;
        audio.onerror = () => fail(new Error('Audio playback failed'));
        audio.play()
          .then(() => {
            if (settled) return;
            startMouth();
            armStallWatchdog();
          })
          .catch(fail);
      });
      if (currentAudio === audio) clearCurrentAudio();
      return true;
    } catch (error) {
      clearCurrentAudio();
      if (isStopError(error)) return false;
      setState({ status: 'error', error: error.message || 'TTS failed' });
      throw error;
    }
  }

  async function play(text, options = {}) {
    const speechText = cleanTtsText(text);
    if (!speechText) return;
    stop();
    queueToken += 1;
    await playInternal(speechText, options, queueToken);
    setState({ status: 'idle', error: '' });
  }

  async function runQueue(token) {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (speechQueue.length && token === queueToken) {
        const item = speechQueue.shift();
        try {
          const audioPromise = prepareQueueItem(item, token, { notifyLoading: true });
          const played = await playInternal(item.text, item.options, token, audioPromise, () => preloadQueuedAudio(token, {
            afterPlaybackStart: true
          }));
          if (played === false) item.reject(makeStopError());
          else item.resolve();
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      queueRunning = false;
      if (token === queueToken && !currentAudio && speechQueue.length < 1) {
        setState({ status: 'idle', error: '' });
      }
      if (speechQueue.length) {
        runQueue(queueToken);
      }
    }
  }

  function enqueue(text, options = {}) {
    const speechText = cleanTtsText(text);
    if (!speechText) return Promise.resolve();
    const settings = readRoomTTSSettings();
    if (!settings.enabled) {
      setState({ status: 'disabled', error: '' });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      speechQueue.push({ text: speechText, options, resolve, reject });
      preloadQueuedAudio(queueToken);
      runQueue(queueToken);
    });
  }

  function clearQueue() {
    rejectQueued();
  }

  function destroy() {
    stop();
    if (audioContext) {
      audioContext.close?.().catch(() => {});
      audioContext = null;
    }
  }

  function warmup() {
    const settings = readRoomTTSSettings();
    if (settings.enabled && isDirectLocalGptSovits(settings)) {
      ensureGptSovitsWeights(settings).catch(() => {});
    }
  }

  warmup();

  return { play, enqueue, playQueued: enqueue, clearQueue, stop, destroy, warmup };
}
