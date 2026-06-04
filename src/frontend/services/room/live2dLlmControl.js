import {
  inferLive2DIntentFromText,
  normalizeLive2DIntent
} from './live2dControl';
import {
  compileBehaviorIntent,
  semanticActionPromptCatalog
} from './live2dBehaviorController';
import { behaviorActionComboPrompt } from '../../constants/room/behaviorActionRegistry';
import { yachiyoCorePersonalityPrompt } from '../../constants/room/yachiyoPersonalityPrompt';
import {
  semanticExpressionIds,
  semanticExpressionPromptCatalog
} from '../../constants/room/yachiyoExpressionPresetRegistry';
import {
  cleanLive2DReply,
  extractLive2DStageDirections
} from './live2dText';
import {
  buildLive2DMemoryPrompt,
  recordLive2DSessionMemoryTurn,
  sanitizeMemoryWrites,
  writePendingLive2DMemories
} from './live2dMemory';
import { buildLive2DVisionPrompt } from './live2dVision';
import { normalizeLive2DMusicCommand } from './live2dMusic';
import { normalizeLLMApiUrl, readRoomLLMSettings } from './roomSettings';
import { readJson, writeJson } from './roomStorage';

const HISTORY_KEY = 'live2dLLMControlHistory';
const HARD_SENTENCE_END_PATTERN = /[\u3002\uff01\uff1f.!?\u2026]/u;
const SOFT_SENTENCE_END_PATTERN = /[\uff0c\u3001,;\uff1b\n]/u;
const SENTENCE_TRAILING_PATTERN = /[\s"'\u201d\u2019\uff09)\]\u3011\u300b\u300d\u300f]+/u;
const FIRST_TTS_CHUNK_UNIT_LIMIT = 8;
const FOLLOWUP_TTS_CHUNK_UNIT_LIMIT = 20;
const FIRST_SOFT_CHUNK_UNIT_LIMIT = 12;
const FOLLOWUP_SOFT_CHUNK_UNIT_LIMIT = 30;
const FIRST_MAX_CHUNK_UNIT_LIMIT = 16;
const FOLLOWUP_MAX_CHUNK_UNIT_LIMIT = 42;
const SEMANTIC_EMOTION_ID_LIST = [
  ...semanticExpressionIds().filter((id) => id !== 'bsmile'),
  'happy',
  'sad'
].filter((id, index, all) => all.indexOf(id) === index).join('|');
const SPEECH_STYLE_BY_EMOTION = {
  happy: { speed: 1.08, pitch: 0.08, pause: 'bright' },
  smile: { speed: 1.06, pitch: 0.07, pause: 'warm' },
  closed_smile: { speed: 1.07, pitch: 0.08, pause: 'bright' },
  closed_eyes: { speed: 0.98, pitch: 0.04, pause: 'warm' },
  smug: { speed: 1.04, pitch: 0.05, pause: 'teasing' },
  shy: { speed: 0.96, pitch: 0.07, pause: 'soft' },
  surprised: { speed: 1.12, pitch: 0.11, pause: 'startled' },
  angry: { speed: 1.08, pitch: -0.02, pause: 'firm' },
  puff: { speed: 1.02, pitch: 0.03, pause: 'pouting' },
  tongue: { speed: 1.07, pitch: 0.08, pause: 'playful' },
  dizzy: { speed: 0.92, pitch: -0.02, pause: 'confused' },
  tear_drop: { speed: 0.9, pitch: -0.05, pause: 'tender' },
  watery_eyes: { speed: 0.92, pitch: -0.04, pause: 'tender' },
  sad: { speed: 0.9, pitch: -0.06, pause: 'tender' },
  crying: { speed: 0.88, pitch: -0.08, pause: 'tearful' },
  fire: { speed: 1.12, pitch: 0.02, pause: 'energetic' },
  neutral: { speed: 1, pitch: 0, pause: 'natural' }
};
const chineseCaptionTranslationCache = new Map();

const SENTENCE_EMOTION_RULES = [
  { emotion: 'fire', pattern: /(燃|爆发|爆發|热血|熱血|认真|認真|furious|rage|fired up|serious)/iu },
  { emotion: 'angry', pattern: /(生气|生氣|愤怒|憤怒|烦|煩|恼火|惱火|angry|annoyed|irritated|mad|scold)/iu },
  { emotion: 'surprised', pattern: /(惊讶|驚訝|震惊|震驚|吓|嚇|哇|wow|surpris|shock|startled|really\?)/iu },
  { emotion: 'puff', pattern: /(鼓脸|鼓臉|撅嘴|不服|哼|pout|puff|sulk|cheek puff)/iu },
  { emotion: 'tongue', pattern: /(吐舌|调皮|調皮|捣蛋|搗蛋|恶作剧|惡作劇|tongue|blep|cheeky|mischief|teasing)/iu },
  { emotion: 'dizzy', pattern: /(晕|暈|困惑|慌|糊涂|糊塗|dizzy|confused|dazed|overwhelmed|panic)/iu },
  { emotion: 'closed_smile', pattern: /(笑咪咪|笑眯眯|眯眼笑|えへへ|ふふ|giggle|closed[- ]eye smile|smiling eyes)/iu },
  { emotion: 'closed_eyes', pattern: /(眯眯眼|眯眼|闭眼|閉眼|满足|滿足|content|satisfied|closed eyes|squint)/iu },
  { emotion: 'tear_drop', pattern: /(泪珠|淚珠|单颗眼泪|單顆眼淚|single tear|teardrop|tear drop)/iu },
  { emotion: 'watery_eyes', pattern: /(泪眼|淚眼|涙目|眼泪汪汪|眼淚汪汪|watery eyes|teary eyes)/iu },
  { emotion: 'crying', pattern: /(大哭|哭泣|流泪|流淚|痛哭|crying|tears|sob|weeping|泣く|泣いて)/iu },
  { emotion: 'sad', pattern: /(难过|難過|悲伤|悲傷|伤心|傷心|寂寞|眼泪|眼淚|sad|sorrow|lonely|悲しい)/iu },
  { emotion: 'smug', pattern: /(得意|坏笑|壞笑|小坏|小壞|smug|smirk|sly|confident)/iu },
  { emotion: 'shy', pattern: /(害羞|脸红|臉紅|不好意思|照れ|shy|blush|embarrassed|bashful|flustered)/iu },
  { emotion: 'happy', pattern: /(开心|開心|高兴|高興|愉快|微笑|笑|喜欢|喜歡|happy|smile|joy|cheerful|嬉しい|優しい)/iu }
];

const SENTENCE_ACTIONS_BY_EMOTION = {
  happy: [{ type: 'smile', duration: 1.2 }, { type: 'bounce', duration: 1.1, delay: 0.1 }, { type: 'ear_wiggle', duration: 1.1, delay: 0.14, intensity: 0.62 }, { type: 'nod', duration: 1.15, delay: 0.22 }],
  smile: [{ type: 'smile', duration: 1.25 }, { type: 'sway', duration: 1.25, delay: 0.12 }, { type: 'ear_perk', duration: 1.1, delay: 0.18, intensity: 0.54 }, { type: 'look_at_chat', duration: 0.9, delay: 0.28 }],
  closed_smile: [{ type: 'smile', duration: 1.2 }, { type: 'bounce', duration: 1.0, delay: 0.08 }, { type: 'ear_wiggle', duration: 1.05, delay: 0.16, intensity: 0.56 }],
  closed_eyes: [{ type: 'breathe', duration: 1.3 }, { type: 'sway', duration: 1.15, delay: 0.12 }, { type: 'look_at_chat', duration: 0.85, delay: 0.24 }],
  smug: [{ type: 'smirk', duration: 1.25 }, { type: 'lean_in', duration: 1.2, delay: 0.12 }, { type: 'head_tilt', side: 'random', duration: 1.1, delay: 0.22 }],
  shy: [{ type: 'smile', duration: 1.1 }, { type: 'blink', duration: 0.34, delay: 0.1 }, { type: 'sway', duration: 1.25, delay: 0.24 }],
  surprised: [{ type: 'surprised', duration: 0.95 }, { type: 'ear_perk', duration: 1.05, delay: 0.05, intensity: 0.72 }, { type: 'lean_in', duration: 1.1, delay: 0.08 }, { type: 'bounce', duration: 1, delay: 0.22 }],
  angry: [{ type: 'lean_in', duration: 1.2 }, { type: 'emphasis', duration: 0.95, delay: 0.12 }, { type: 'shake_head', duration: 1.05, delay: 0.28 }],
  puff: [{ type: 'shake_head', duration: 0.95 }, { type: 'sway', duration: 1.2, delay: 0.12 }, { type: 'look_at_chat', duration: 0.9, delay: 0.26 }],
  tongue: [{ type: 'tongue_out', duration: 0.72 }, { type: 'smirk', duration: 1.1, delay: 0.08 }, { type: 'ear_wiggle', duration: 1.08, delay: 0.14, intensity: 0.64 }, { type: 'wink', side: 'random', duration: 0.52, delay: 0.18 }, { type: 'lean_in', duration: 1.05, delay: 0.24 }],
  dizzy: [{ type: 'shake_head', duration: 1.05 }, { type: 'sway', duration: 1.25, delay: 0.12 }, { type: 'blink', duration: 0.34, delay: 0.5 }],
  tear_drop: [{ type: 'breathe', duration: 1.3 }, { type: 'nod', duration: 1.05, delay: 0.16 }, { type: 'look_at_chat', duration: 0.85, delay: 0.34 }],
  watery_eyes: [{ type: 'nod', duration: 1.05 }, { type: 'breathe', duration: 1.35, delay: 0.16 }, { type: 'look_at_chat', duration: 0.85, delay: 0.32 }],
  sad: [{ type: 'breathe', duration: 1.4 }, { type: 'nod', duration: 1.15, delay: 0.16 }, { type: 'look_at_chat', duration: 0.9, delay: 0.34 }],
  crying: [{ type: 'shiver', duration: 1.05 }, { type: 'breathe', duration: 1.25, delay: 0.2 }, { type: 'nod', duration: 1.1, delay: 0.36 }],
  fire: [{ type: 'lean_in', duration: 1.15 }, { type: 'emphasis', duration: 0.95, delay: 0.12 }, { type: 'bounce', duration: 0.95, delay: 0.28 }],
  neutral: [{ type: 'look_at_chat', duration: 0.95 }, { type: 'breathe', duration: 1.35, delay: 0.1 }]
};

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

function extractJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  return start >= 0 && end > start ? value.slice(start, end + 1).trim() : value;
}

function extractLabeledJsonObject(text, labels = ['CONTROL', 'JSON', 'LIVE2D_CONTROL']) {
  const value = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  let startIndex = -1;
  for (const label of labels) {
    const match = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(label)}\\s*[:：]`, 'i').exec(value);
    if (!match) continue;
    startIndex = Math.max(startIndex, match.index + match[0].length);
  }
  if (startIndex < 0) return '';
  return extractJsonObject(value.slice(startIndex));
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeJsonEscape(char, tail) {
  if (char === 'n') return ['\n', 0];
  if (char === 'r') return ['\r', 0];
  if (char === 't') return ['\t', 0];
  if (char === 'b') return ['\b', 0];
  if (char === 'f') return ['\f', 0];
  if (char === 'u') {
    const hex = tail.slice(0, 4);
    if (/^[0-9a-f]{4}$/i.test(hex)) return [String.fromCharCode(parseInt(hex, 16)), 4];
    return ['', -1];
  }
  return [char, 0];
}

function readJsonStringFieldProgress(text, fieldName) {
  const value = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const marker = new RegExp(`"${escapeRegExp(fieldName)}"\\s*:\\s*"`, 'i').exec(value);
  if (!marker) return { value: '', complete: false, found: false };

  let result = '';
  let index = marker.index + marker[0].length;
  while (index < value.length) {
    const char = value[index];
    if (char === '"') return { value: result, complete: true, found: true };
    if (char === '\\') {
      const next = value[index + 1];
      if (!next) break;
      const [decoded, consumed] = decodeJsonEscape(next, value.slice(index + 2));
      if (consumed < 0) break;
      result += decoded;
      index += 2 + consumed;
      continue;
    }
    result += char;
    index += 1;
  }
  return { value: result, complete: false, found: true };
}

function readReplyFieldProgress(text) {
  for (const fieldName of ['reply', 'text', 'message']) {
    const field = readJsonStringFieldProgress(text, fieldName);
    if (field.found) return field;
  }
  return { value: '', complete: false, found: false };
}

function readStreamingSpeechProgress(text) {
  const value = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const beforeControl = value.split(/\n\s*(?:CONTROL|JSON|LIVE2D_CONTROL)\s*[:：]/i)[0] || '';
  const pieces = [];
  beforeControl.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*(?:SAY|SPEECH|VOICE|LINE)\s*[:：]\s*(.*)$/i);
    if (match) pieces.push(match[1]);
  });
  return pieces.join('\n').trim();
}

function parseStreamingBeatLine(line) {
  const match = String(line || '').match(/^\s*(?:BEAT|EMOTION_BEAT|ACTION_BEAT)\s*[:：]\s*(.*)$/i);
  if (!match) return null;
  const source = extractJsonObject(match[1]);
  if (!source || !source.startsWith('{')) return null;
  try {
    const data = JSON.parse(source);
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

function readStreamingBeatsProgress(text) {
  const value = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const beforeControl = value.split(/\n\s*(?:CONTROL|JSON|LIVE2D_CONTROL)\s*[:：]/i)[0] || '';
  return beforeControl
    .split(/\r?\n/)
    .map((line) => parseStreamingBeatLine(line))
    .filter(Boolean);
}

function speakableUnitLength(text) {
  return String(text || '')
    .replace(/[\s"'“”‘’()（）[\]【】《》「」『』.,;:!?，。！？、；：…~\-]/g, '')
    .length;
}

function chunkProfileFor(text, chunkIndex = 0) {
  const value = String(text || '');
  const hasCjk = /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
  const first = chunkIndex < 1;
  return {
    min: hasCjk ? (first ? FIRST_TTS_CHUNK_UNIT_LIMIT : FOLLOWUP_TTS_CHUNK_UNIT_LIMIT) : (first ? 18 : 58),
    soft: hasCjk ? (first ? FIRST_SOFT_CHUNK_UNIT_LIMIT : FOLLOWUP_SOFT_CHUNK_UNIT_LIMIT) : (first ? 28 : 86),
    max: hasCjk ? (first ? FIRST_MAX_CHUNK_UNIT_LIMIT : FOLLOWUP_MAX_CHUNK_UNIT_LIMIT) : (first ? 42 : 130)
  };
}

function consumeTrailing(text, startIndex) {
  let endIndex = startIndex;
  while (endIndex < text.length && SENTENCE_TRAILING_PATTERN.test(text[endIndex])) {
    endIndex += 1;
  }
  return endIndex;
}

function findSoftChunkCutIndex(text, chunkIndex = 0) {
  const value = String(text || '');
  const hasCjk = /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
  const profile = chunkProfileFor(value, chunkIndex);
  let units = 0;
  let lastWhitespace = -1;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/\s/u.test(char)) {
      if (units >= profile.min) lastWhitespace = index + 1;
      continue;
    }
    if (speakableUnitLength(char) < 1) continue;
    units += 1;
    if (SOFT_SENTENCE_END_PATTERN.test(char) && units >= profile.min) return consumeTrailing(value, index + 1);
    if (units < profile.soft) continue;
    if (!hasCjk && lastWhitespace > 0) return lastWhitespace;
    if (hasCjk || units >= profile.max) return index + 1;
  }
  return -1;
}

function findSentenceCutIndex(text, chunkIndex = 0, flush = false) {
  const profile = chunkProfileFor(text, chunkIndex);
  let units = 0;
  let lastWhitespace = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/u.test(char)) {
      if (units >= profile.min) lastWhitespace = index + 1;
    } else if (speakableUnitLength(char) > 0) {
      units += 1;
    }
    if (HARD_SENTENCE_END_PATTERN.test(char)) {
      if (flush || units >= profile.min) return consumeTrailing(text, index + 1);
      continue;
    }
    if (SOFT_SENTENCE_END_PATTERN.test(char) && units >= profile.min) {
      return consumeTrailing(text, index + 1);
    }
    if (!flush && units >= profile.max) return lastWhitespace > 0 ? lastWhitespace : index + 1;
  }
  return -1;
}

function splitCompletedSentences(buffer, flush = false, emittedCount = 0) {
  const sentences = [];
  let rest = String(buffer || '');
  while (rest) {
    const chunkIndex = emittedCount + sentences.length;
    const cutIndex = findSentenceCutIndex(rest, chunkIndex, flush);
    const softCutIndex = cutIndex < 0 && !flush ? findSoftChunkCutIndex(rest, chunkIndex) : -1;
    if (cutIndex < 0 && softCutIndex < 0) break;
    const endIndex = cutIndex >= 0 ? cutIndex : softCutIndex;
    const sentence = rest.slice(0, endIndex).trim();
    if (sentence) sentences.push(sentence);
    rest = rest.slice(endIndex);
  }
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = '';
  }
  return { sentences, rest };
}

function shouldJoinSpeechChunksWithSpace(left, right) {
  return /[A-Za-z0-9]$/.test(String(left || '').trim()) && /^[A-Za-z0-9]/.test(String(right || '').trim());
}

function joinSpeechChunks(left, right) {
  const previous = cleanReplyForSpeech(left);
  const next = cleanReplyForSpeech(right);
  if (!previous) return next;
  if (!next) return previous;
  return `${previous}${shouldJoinSpeechChunksWithSpace(previous, next) ? ' ' : ''}${next}`;
}

function normalizeStreamingBeat(rawBeat = {}, sentence = '', fallbackEmotion = 'neutral', fallbackSpeechStyle = null) {
  const beat = rawBeat && typeof rawBeat === 'object' ? rawBeat : {};
  const nested = beat.live2d && typeof beat.live2d === 'object' ? beat.live2d : {};
  const emotion = normalizeEmotion(
    beat.emotion || beat.mood || beat.expression || nested.emotion || nested.mood || nested.expression,
    fallbackEmotion
  );
  const rawActions = beat.actions || beat.behaviorActions || beat.behaviourActions || nested.actions || nested.behaviorActions || [];
  const actions = Array.isArray(rawActions)
    ? rawActions
    : (rawActions ? [{ type: rawActions }] : []);
  const speechStyle = beat.speech_style || beat.speechStyle || nested.speech_style || nested.speechStyle || fallbackSpeechStyle || null;

  return {
    reply: sentence,
    text: sentence,
    emotion,
    mood: emotion,
    intensity: beat.intensity ?? nested.intensity ?? (emotion === 'neutral' ? 0.58 : 0.72),
    priority: beat.priority ?? nested.priority,
    interruptPolicy: beat.interruptPolicy || beat.interrupt || nested.interruptPolicy || nested.interrupt || null,
    actions,
    speech_style: speechStyleForEmotion(emotion, speechStyle)
  };
}

function buildBeatLive2DIntent(sentence, beat, fallbackEmotion = 'neutral', fallbackSpeechStyle = null) {
  const payload = normalizeStreamingBeat(beat, sentence, fallbackEmotion, fallbackSpeechStyle);
  const behaviorIntent = compileBehaviorIntent(payload);
  const inferredIntent = inferLive2DIntentFromText(sentence);
  return mergeBehaviorAndExplicitIntent(behaviorIntent, inferredIntent) || behaviorIntent || inferredIntent;
}

function createReplySentenceEmitter(handlers = {}) {
  let seenReply = '';
  let sentenceBuffer = '';
  let pendingShortSentence = '';
  let seenBeatCount = 0;
  const pendingBeats = [];
  let emittedCount = 0;

  const dispatchSentence = (text) => {
    const sentence = cleanReplyForSpeech(text);
    if (!sentence || speakableUnitLength(sentence) < 2) return;
    const analysis = analyzeLive2DSentenceEmotion(sentence);
    const beat = pendingBeats.shift() || null;
    const speechStyle = beat
      ? speechStyleForEmotion(normalizeEmotion(beat.emotion || beat.mood || beat.expression, analysis.emotion), beat.speech_style || beat.speechStyle || null)
      : analysis.speechStyle;
    const live2d = beat
      ? buildBeatLive2DIntent(sentence, beat, analysis.emotion, analysis.speechStyle)
      : buildSentenceLive2DIntent(sentence, analysis.emotion, analysis.speechStyle);
    const emotion = live2d?.emotion || live2d?.expression || analysis.emotion;
    emittedCount += 1;
    handlers.onSentence?.({
      index: emittedCount,
      text: sentence,
      emotion,
      speechStyle: live2d?.speechStyle || speechStyle,
      live2d,
      beat
    });
  };

  const emitSentence = (text, options = {}) => {
    let sentence = cleanReplyForSpeech(text);
    if (pendingShortSentence) {
      sentence = joinSpeechChunks(pendingShortSentence, sentence);
      pendingShortSentence = '';
    }
    if (!sentence) return;
    const minUnits = emittedCount < 1 ? FIRST_TTS_CHUNK_UNIT_LIMIT : FOLLOWUP_TTS_CHUNK_UNIT_LIMIT;
    if (options.allowHold !== false && speakableUnitLength(sentence) < minUnits) {
      pendingShortSentence = sentence;
      return;
    }
    dispatchSentence(sentence);
  };

  const flushPendingSentence = () => {
    if (!pendingShortSentence) return;
    const sentence = pendingShortSentence;
    pendingShortSentence = '';
    dispatchSentence(sentence);
  };

  const pushReply = (reply, options = {}) => {
    const current = String(reply || '');
    if (current.length > seenReply.length) {
      sentenceBuffer += current.slice(seenReply.length);
      seenReply = current;
    }
    const split = splitCompletedSentences(sentenceBuffer, Boolean(options.flush), emittedCount);
    sentenceBuffer = split.rest;
    split.sentences.forEach((sentence) => emitSentence(sentence, { allowHold: true }));
    if (options.flush) flushPendingSentence();
  };

  return {
    pushRaw(rawText, options = {}) {
      const beats = readStreamingBeatsProgress(rawText);
      if (beats.length > seenBeatCount) {
        pendingBeats.push(...beats.slice(seenBeatCount));
        seenBeatCount = beats.length;
      }
      const streamingSpeech = readStreamingSpeechProgress(rawText);
      if (streamingSpeech) {
        pushReply(streamingSpeech, { flush: options.flush });
        return;
      }
      const field = readReplyFieldProgress(rawText);
      if (!field.found) return;
      pushReply(field.value, { flush: options.flush || field.complete });
    },
    flushReply(reply) {
      pushReply(reply, { flush: true });
    },
    get emittedCount() {
      return emittedCount;
    }
  };
}

function parseSsePacket(packet) {
  const lines = String(packet || '').split(/\r?\n/);
  let event = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message';
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  return { event, data: dataLines.join('\n') };
}

function pickStreamDelta(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.delta === 'string') return data.delta;
  if (typeof data.text === 'string' && /delta/i.test(String(data.type || ''))) return data.text;
  if (typeof data.output_text_delta === 'string') return data.output_text_delta;
  if (Array.isArray(data.choices)) {
    return data.choices
      .map((choice) => choice?.delta?.content || choice?.delta?.text || choice?.text || choice?.message?.content || '')
      .join('');
  }
  return pickReply(data);
}

async function readStreamingTextResponse(response, handlers = {}) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/event-stream|stream/i.test(contentType)) {
    const data = await response.json().catch(() => null);
    const text = pickReply(data);
    if (text) handlers.onText?.(text, text, data);
    return text;
  }

  if (!response.body?.getReader) {
    const data = await response.json().catch(() => null);
    return pickReply(data);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let packetBuffer = '';
  let rawText = '';

  const handlePacket = (packet) => {
    const { event, data } = parseSsePacket(packet);
    if (!data || data === '[DONE]') return;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_) {
      rawText += data;
      handlers.onEvent?.({ event, payload: null, delta: data, rawText });
      handlers.onText?.(data, rawText);
      return;
    }
    if (event === 'error' || payload?.success === false) {
      throw new Error(payload?.message || payload?.error?.message || 'LLM stream failed');
    }
    const delta = pickStreamDelta(payload);
    handlers.onEvent?.({ event, payload, delta, rawText });
    if (!delta) return;
    rawText += delta;
    handlers.onText?.(delta, rawText, payload);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    packetBuffer += decoder.decode(value, { stream: true });
    const packets = packetBuffer.split(/\r?\n\r?\n/);
    packetBuffer = packets.pop() || '';
    for (const packet of packets) handlePacket(packet);
  }
  packetBuffer += decoder.decode();
  if (packetBuffer.trim()) handlePacket(packetBuffer);
  return rawText;
}

function cleanReply(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/(?:^|\n)\s*(?:动作|表情|姿态|语气|神态|Action|Expression)\s*[:：][^\n]{1,160}(?=\n|$)/giu, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanReplyForSpeech(text) {
  return cleanLive2DReply(text);
}

function normalizeEmotion(value, fallback = 'neutral') {
  const token = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (token === 'smile') return 'happy';
  if (token === 'tears' || token === 'namida') return token === 'namida' ? 'sad' : 'crying';
  return SPEECH_STYLE_BY_EMOTION[token] ? token : fallback;
}

function speechStyleForEmotion(emotion, overrides = null) {
  return {
    ...(SPEECH_STYLE_BY_EMOTION[normalizeEmotion(emotion)] || SPEECH_STYLE_BY_EMOTION.neutral),
    ...(overrides && typeof overrides === 'object' ? overrides : {})
  };
}

export function analyzeLive2DSentenceEmotion(text, fallbackEmotion = 'neutral') {
  const value = String(text || '').trim();
  const rule = SENTENCE_EMOTION_RULES.find((item) => item.pattern.test(value));
  const inferred = inferLive2DIntentFromText(value);
  const emotion = normalizeEmotion(rule?.emotion || inferred?.emotion || inferred?.expression, normalizeEmotion(fallbackEmotion));
  return {
    emotion,
    speechStyle: speechStyleForEmotion(emotion)
  };
}

function sentenceActionsForEmotion(emotion) {
  const actions = SENTENCE_ACTIONS_BY_EMOTION[normalizeEmotion(emotion)] || SENTENCE_ACTIONS_BY_EMOTION.neutral;
  return actions.map((action) => ({ ...action }));
}

function buildSentenceLive2DIntent(text, emotion, speechStyle = null) {
  const analyzedEmotion = normalizeEmotion(emotion);
  const behaviorIntent = compileBehaviorIntent({
    reply: text,
    emotion: analyzedEmotion,
    intensity: analyzedEmotion === 'neutral' ? 0.58 : 0.72,
    actions: sentenceActionsForEmotion(analyzedEmotion),
    speech_style: speechStyle || speechStyleForEmotion(analyzedEmotion)
  });
  const inferredIntent = inferLive2DIntentFromText(text);
  return mergeBehaviorAndExplicitIntent(behaviorIntent, inferredIntent) || behaviorIntent || inferredIntent;
}

function hasBodyPose(intent) {
  return Boolean(intent?.bodyPose || intent?.sequence?.some((step) => step?.bodyPose));
}

function hasExpression(intent) {
  return Boolean(
    intent?.expression ||
    intent?.expressionMix?.length ||
    intent?.sequence?.some((step) => step?.expression || step?.expressionMix?.length)
  );
}

function mergeParameterTargets(primary = [], fallback = []) {
  const merged = Array.isArray(primary) ? [...primary] : [];
  const seen = new Set(merged.map((item) => String(item?.id || '').toLowerCase()).filter(Boolean));
  for (const target of Array.isArray(fallback) ? fallback : []) {
    const key = String(target?.id || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    merged.push(target);
    seen.add(key);
  }
  return merged;
}

function mergeInferredLive2DIntent(explicitIntent, inferredIntent) {
  if (!explicitIntent) return inferredIntent;
  if (!inferredIntent) return explicitIntent;

  const explicitHasBehavior = Array.isArray(explicitIntent.behaviorActions) && explicitIntent.behaviorActions.length > 0;
  const explicitHasBody = hasBodyPose(explicitIntent);
  const explicitHasExpression = hasExpression(explicitIntent);
  const strongerIntensity = Math.max(Number(explicitIntent.intensity) || 0, Number(inferredIntent.intensity) || 0) || undefined;
  const next = {
    ...explicitIntent,
    emotion: explicitIntent.emotion || inferredIntent.emotion,
    expression: explicitHasExpression ? explicitIntent.expression : inferredIntent.expression,
    expressionMix: explicitHasExpression ? explicitIntent.expressionMix : inferredIntent.expressionMix,
    motion: explicitIntent.motion || (!explicitHasBody ? inferredIntent.motion : null),
    bodyPose: explicitHasBody ? explicitIntent.bodyPose : inferredIntent.bodyPose,
    intensity: strongerIntensity || explicitIntent.intensity || inferredIntent.intensity,
    durationMs: explicitIntent.durationMs || inferredIntent.durationMs,
    priority: Math.max(Number(explicitIntent.priority) || 0, Number(inferredIntent.priority) || 0) || explicitIntent.priority || inferredIntent.priority,
    interruptPolicy: explicitIntent.interruptPolicy || inferredIntent.interruptPolicy || null,
    behaviorActions: mergeBehaviorActions(explicitIntent.behaviorActions, explicitHasBehavior ? [] : inferredIntent.behaviorActions),
    speechStyle: explicitIntent.speechStyle || inferredIntent.speechStyle || null,
    parameters: mergeParameterTargets(
      explicitIntent.parameters,
      explicitHasBody || explicitHasBehavior ? [] : inferredIntent.parameters
    )
  };

  if (Array.isArray(explicitIntent.sequence) && explicitIntent.sequence.length) {
    if (!explicitHasBody && !explicitHasBehavior && explicitIntent.sequence.length === 1) {
      delete next.sequence;
    } else {
      next.sequence = explicitIntent.sequence.map((step, index) => {
        if (explicitHasBody || explicitHasBehavior || index > 0) return step;
        return {
          ...step,
          bodyPose: step.bodyPose || inferredIntent.bodyPose,
          motion: step.motion || inferredIntent.motion,
          intensity: Math.max(Number(step.intensity) || 0, Number(inferredIntent.intensity) || 0) || step.intensity || inferredIntent.intensity,
          durationMs: step.durationMs || inferredIntent.durationMs,
          priority: Math.max(Number(step.priority) || 0, Number(inferredIntent.priority) || 0) || step.priority || inferredIntent.priority,
          interruptPolicy: step.interruptPolicy || inferredIntent.interruptPolicy || null,
          parameters: mergeParameterTargets(step.parameters, inferredIntent.parameters)
        };
      });
    }
  }

  return normalizeLive2DIntent(next) || explicitIntent;
}

function mergeBehaviorActions(primary = [], secondary = []) {
  const merged = [];
  const seen = new Set();
  for (const action of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const type = String(action?.type || action?.action || action?.name || '').trim();
    if (!type) continue;
    const key = `${type}:${action?.side || action?.direction || ''}`;
    if (seen.has(key)) continue;
    merged.push({ ...action });
    seen.add(key);
  }
  return merged.slice(0, 8);
}

function mergeBehaviorAndExplicitIntent(behaviorIntent, explicitIntent) {
  if (!behaviorIntent) return explicitIntent;
  if (!explicitIntent) return normalizeLive2DIntent(behaviorIntent);
  return normalizeLive2DIntent({
    ...explicitIntent,
    emotion: explicitIntent.emotion || behaviorIntent.emotion,
    expression: explicitIntent.expression || behaviorIntent.expression,
    expressionMix: explicitIntent.expressionMix?.length ? explicitIntent.expressionMix : behaviorIntent.expressionMix,
    bodyPose: explicitIntent.bodyPose || behaviorIntent.bodyPose,
    intensity: Math.max(Number(explicitIntent.intensity) || 0, Number(behaviorIntent.intensity) || 0) || behaviorIntent.intensity,
    durationMs: Math.max(Number(explicitIntent.durationMs) || 0, Number(behaviorIntent.durationMs) || 0) || behaviorIntent.durationMs,
    priority: Math.max(Number(explicitIntent.priority) || 0, Number(behaviorIntent.priority) || 0) || behaviorIntent.priority,
    interruptPolicy: explicitIntent.interruptPolicy || behaviorIntent.interruptPolicy,
    parameters: mergeParameterTargets(behaviorIntent.parameters, explicitIntent.parameters),
    behaviorActions: mergeBehaviorActions(explicitIntent.behaviorActions, behaviorIntent.behaviorActions),
    speechStyle: behaviorIntent.speechStyle
  });
}

function normalizeMemoryWritesFromPayload(data) {
  return sanitizeMemoryWrites(data?.memory_writes || data?.memoryWrites || []);
}

function musicSourceWithProvider(source, provider) {
  if (!source) return null;
  return typeof source === 'object'
    ? { provider, ...source }
    : { provider, query: source };
}

function normalizeMusicFromPayload(data = {}) {
  if (!data || typeof data !== 'object') return null;
  const nestedSources = [
    data.music,
    data.music_request,
    data.musicRequest,
    musicSourceWithProvider(data.appleMusic, 'apple-music'),
    musicSourceWithProvider(data.neteaseMusic, 'netease-cloud'),
    musicSourceWithProvider(data.netease_music, 'netease-cloud'),
    data.song_request,
    data.songRequest,
    data.requestSong,
    data['点歌'],
    data['音乐'],
    musicSourceWithProvider(data['网易云'], 'netease-cloud'),
    musicSourceWithProvider(data['本地音乐'], 'local-library')
  ];
  for (const source of nestedSources) {
    const command = normalizeLive2DMusicCommand(source);
    if (command) return command;
  }

  const rootMusicKeys = [
    'action',
    'command',
    'type',
    'intent',
    'query',
    'keyword',
    'keywords',
    'search',
    'song',
    'title',
    'name',
    'songName',
    'track',
    'artist',
    'artistName',
    'singer',
    'singers',
    'artists',
    'provider',
    'platform',
    'service',
    'source',
    'songId',
    'url',
    '动作',
    '查询',
    '关键词',
    '歌曲',
    '歌名',
    '歌手',
    '艺人',
    '平台',
    '来源'
  ];
  if (!rootMusicKeys.some((key) => Object.prototype.hasOwnProperty.call(data, key))) return null;
  return normalizeLive2DMusicCommand(data);
}

export function parseLive2DControlPayload(rawText) {
  const jsonText = extractLabeledJsonObject(rawText) || extractJsonObject(rawText);
  try {
    const data = JSON.parse(jsonText);
    const rawReply = data.reply || data.text || data.message || '';
    const stageText = extractLive2DStageDirections(`${rawReply}\n${rawText}`);
    const reply = cleanReplyForSpeech(rawReply);
    const behaviorLive2D = compileBehaviorIntent(data);
    const explicitLive2D = mergeBehaviorAndExplicitIntent(
      behaviorLive2D,
      normalizeLive2DIntent(data.live2d || data.act || data.pose || data)
    );
    const inferredLive2D = inferLive2DIntentFromText([stageText, reply].filter(Boolean).join('\n'));
    const live2d = mergeInferredLive2DIntent(explicitLive2D, inferredLive2D);
    return {
      reply: reply || 'OK.',
      live2d,
      music: normalizeMusicFromPayload(data),
      memoryWrites: normalizeMemoryWritesFromPayload(data),
      raw: data
    };
  } catch (_) {
    const stageText = extractLive2DStageDirections(rawText);
    const streamingSpeech = readStreamingSpeechProgress(rawText);
    const reply = cleanReplyForSpeech(streamingSpeech || rawText) || 'OK.';
    const behaviorLive2D = compileBehaviorIntent({ reply, text: [stageText, reply].filter(Boolean).join('\n') });
    const inferredLive2D = inferLive2DIntentFromText([stageText, reply].filter(Boolean).join('\n'));
    return {
      reply,
      live2d: mergeBehaviorAndExplicitIntent(behaviorLive2D, inferredLive2D),
      music: null,
      memoryWrites: [],
      raw: rawText
    };
  }
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
    'X-OpenRouter-Title': 'Tsukuyomi Space'
  };
}

function detectCaptionLang(text) {
  const value = String(text || '');
  if (/[\u3040-\u30ff]/u.test(value)) return 'ja';
  if (/[\u4e00-\u9fff]/u.test(value)) return 'zh';
  return 'other';
}

function chineseCaptionTranslatorPrompt() {
  return [
    'You translate VTuber spoken Japanese into Simplified Chinese captions.',
    'Output only the Chinese caption text. Do not use Markdown or explanations.',
    'Keep the cute livestream tone, short interjections, punctuation, and sentence rhythm.',
    'Remove stage directions, parenthesized action hints, asterisk actions, pose descriptions, and emotion labels.',
    'If the input is already Simplified Chinese, return it unchanged.'
  ].join('\n');
}

export async function translateLive2DReplyToChinese(text) {
  const source = cleanReplyForSpeech(text);
  if (!source) return '';
  if (detectCaptionLang(source) === 'zh') return source;
  const cacheKey = source.slice(0, 240);
  if (chineseCaptionTranslationCache.has(cacheKey)) return chineseCaptionTranslationCache.get(cacheKey);

  const settings = readRoomLLMSettings();
  if (!settings.apiKey || !settings.apiUrl) return '';
  const systemPrompt = chineseCaptionTranslatorPrompt();
  const promise = (async () => {
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
      if (!response.ok || !result.success) throw new Error(result.message || `Caption translate LLM ${response.status}`);
      const translated = cleanReplyForSpeech(result.data?.reply || '');
      return detectCaptionLang(translated) === 'ja' ? '' : translated;
    }

    const model = settings.model || 'gpt-4o-mini';
    const apiUrl = normalizeOpenAIUrl(settings.apiUrl, model, settings.provider);
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
            max_output_tokens: 120
          }
        : {
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: source }
            ],
            temperature: isKimiChatTarget(apiUrl, model) ? 1 : 0.2,
            max_tokens: 120
          })
    });
    if (!response.ok) throw new Error(`Caption translate LLM ${response.status}`);
    const translated = cleanReplyForSpeech(pickReply(await response.json()));
    return detectCaptionLang(translated) === 'ja' ? '' : translated;
  })().catch((error) => {
    chineseCaptionTranslationCache.delete(cacheKey);
    throw error;
  });
  chineseCaptionTranslationCache.set(cacheKey, promise);
  return promise;
}

function visionUserContent(message, visionPayload, responsesApi = false) {
  if (!visionPayload?.imageBase64) return String(message || '');
  const imageUrl = String(visionPayload.imageBase64 || '').startsWith('data:')
    ? visionPayload.imageBase64
    : `data:${visionPayload.mimeType || 'image/png'};base64,${visionPayload.imageBase64}`;
  if (responsesApi) {
    return [
      { type: 'input_text', text: String(message || '') },
      { type: 'input_image', image_url: imageUrl, detail: visionPayload.detail || 'low' }
    ];
  }
  return [
    { type: 'text', text: String(message || '') },
    {
      type: 'image_url',
      image_url: {
        url: imageUrl,
        detail: visionPayload.detail || 'low'
      }
    }
  ];
}

function buildDirectRequestBody(settings, systemPrompt, history, message, visionPayload = null) {
  const model = settings.model || 'gpt-4o-mini';
  const apiUrl = normalizeOpenAIUrl(settings.apiUrl || '', model, settings.provider);
  if (isOpenAIResponsesApi(apiUrl)) {
    return {
      model: settings.model || 'gpt-5.5',
      instructions: systemPrompt,
      input: [
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') })),
        { role: 'user', content: visionUserContent(message, visionPayload, true) }
      ],
      max_output_tokens: 1000
    };
  }
  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map((item) => ({ role: item.role, content: String(item.content || '') })),
      { role: 'user', content: visionUserContent(message, visionPayload, false) }
    ],
    temperature: isKimiChatTarget(apiUrl, model) ? 1 : 0.4,
    max_tokens: 1000
  };
}

function buildStreamingDirectRequestBody(settings, systemPrompt, history, message, visionPayload = null) {
  return {
    ...buildDirectRequestBody(settings, systemPrompt, history, message, visionPayload),
    stream: true
  };
}

function finishLive2DControlRequest(message, history, rawReply, sentenceEmitter = null) {
  const parsed = parseLive2DControlPayload(rawReply);
  if (sentenceEmitter && sentenceEmitter.emittedCount < 1) {
    sentenceEmitter.flushReply(parsed.reply);
  }
  if (parsed.memoryWrites?.length) {
    writePendingLive2DMemories(parsed.memoryWrites).catch(() => {});
  }
  recordLive2DSessionMemoryTurn({
    source: 'llm-control',
    input: message,
    reply: parsed.reply,
    emotion: parsed.live2d?.emotion || parsed.live2d?.expression || parsed.raw?.emotion || 'neutral'
  });
  const nextHistory = [
    ...history,
    { role: 'user', content: String(message || '') },
    { role: 'assistant', content: parsed.reply }
  ].slice(-8);
  writeJson(HISTORY_KEY, nextHistory);
  return parsed;
}

export function live2DControlSystemPrompt() {
  return [
    'You are controlling a Live2D character named Yachiyo.',
    'Yachiyo is being tested as an autonomous AI VTuber streamer: keep her present, reactive, playful, and concise.',
    'Return exactly one JSON object. Do not use Markdown. Do not add prose outside JSON.',
    'JSON schema:',
    `{"reply":"short visible reply","emotion":"${SEMANTIC_EMOTION_ID_LIST}","intensity":0.72,"actions":[{"type":"look_at_chat","duration":1.2},{"type":"smirk","duration":2.0},{"type":"head_tilt","side":"right","duration":1.5}],"interruptPolicy":{"mode":"blend","priority":4},"speech_style":{"speed":1.05,"pitch":0.08,"pause":"playful"},"music":null,"memory_writes":[]}`,
    'The reply field must contain only natural dialogue. Never put stage directions, parenthesized action hints, asterisk actions, action labels, or pose descriptions in reply.',
    'The actions field is required and must contain at least 2 semantic actions. If the moment is calm, use look_at_chat + breathe.',
    'Actions must match the reply meaning and mood. Vary action combos between turns; do not repeat the same body action unless the dialogue specifically calls for it.',
    'Use only semantic emotion ids and semantic actions. Do not output raw Live2D parameters, VTube Studio parameter ids, expression file names, live2d.parameters, parameterTargets, or pose descriptions.',
    `Choose 2-5 actions per live-stream turn. Good combos: ${behaviorActionComboPrompt()}.`,
    'Use intensity 0.45-0.85 for normal talking, 0.85-1.0 for punchlines or surprise.',
    'Optional interruptPolicy controls action orchestration: use mode blend for normal replies, replace for urgent reactions, protect for moments that should finish; priority is 0-10.',
    'Optional music controls the song request engine. Only include it when the user explicitly asks to request, play next, skip, pause, resume, stop, clear, or inspect music; otherwise set music to null.',
    'Music schema examples: {"action":"request","query":"song title artist"}, {"provider":"netease-cloud","action":"request","query":"song title artist"}, {"provider":"local-library","action":"request","query":"song title artist"}, {"action":"play_next","query":"song title artist"}, {"action":"skip"}, {"action":"pause"}, {"action":"resume"}, {"action":"stop"}, {"action":"queue"}. The runtime may use a local music library, NetEase Cloud Music, or Apple Music; never include tokens, cookies, or credentials.',
    'When the user names NetEase, 网易云, 163, or 云音乐, set music.provider to "netease-cloud". When they explicitly say local file/library, set provider to "local-library". Otherwise omit provider and let Settings choose.',
    'For song requests, always put the executable request in music JSON instead of only saying it in reply. For Chinese requests like 点歌, 来一首, or 加歌, use {"action":"request","query":"song title artist"}. For 播放, 放歌, or 给我放, use action play_now. If they ask to put it next, use play_next.',
    'Treat Chinese phrases such as \u6211\u8981\u542c, \u60f3\u542c, \u542c\u4e00\u4e0b, \u542c\u4e00\u9996, \u653e\u4e00\u9996, or \u6765\u4e00\u9996 as explicit music playback requests; use action play_now unless the user asks to queue or play next.',
    'Use duration in seconds. Overlapping actions are allowed by repeating similar delay values; omit delay for a natural staggered performance.',
    'Only when a durable, low-risk memory is clearly confirmed, include memory_writes items with scope, type, title, text, optional episode, facts, foresight, importance, confidence, and tags. Otherwise use an empty array.',
    'Memory facts must be atomic and verifiable. Foresight must be conservative, evidence-based, and include confidence when useful.',
    'Never propose secrets, API keys, sensitive personal data, raw chat dumps, guesses about a user, or negative personality labels as memory.',
    semanticExpressionPromptCatalog(),
    semanticActionPromptCatalog(),
    'The execution layer maps semantic emotions to expression presets, VTube Studio expressions, and fine motion overlays.'
  ].join('\n');
}

export function live2DStreamingControlSystemPrompt() {
  return [
    'You are controlling a Live2D character named Yachiyo.',
    'This is a low-latency streaming turn. Output one compact semantic BEAT before each Japanese spoken VOICE line, then output final CONTROL JSON at the end.',
    'Output format must be exactly:',
    'BEAT: {"emotion":"happy","intensity":0.68,"actions":[{"type":"look_at_chat","duration":0.9},{"type":"smile","duration":1.2}],"speech_style":{"speed":1.06,"pitch":0.06,"pause":"bright"}}',
    'VOICE: first short Japanese phrase, 8-14 kana/characters if possible, such as うん、聞いてるよ、 or えへへ、いいね、.',
    'BEAT: {"emotion":"smug","intensity":0.72,"actions":[{"type":"smirk","duration":1.1},{"type":"lean_in","duration":1.0,"delay":0.08}],"speech_style":{"speed":1.04,"pitch":0.05,"pause":"teasing"}}',
    'For TTS stability, do not use tiny fragments; the first VOICE should include at least one short phrase, not only a filler.',
    'VOICE: next natural Japanese clause or short sentence, normally about 18-32 Japanese characters.',
    'VOICE: combine tiny comma clauses instead of making every comma its own TTS chunk; prefer one stable phrase over many tiny fragments.',
    `CONTROL: {"reply":"same Japanese spoken text without VOICE labels","emotion":"${SEMANTIC_EMOTION_ID_LIST}","intensity":0.72,"actions":[{"type":"look_at_chat","duration":1.2},{"type":"smirk","duration":2.0}],"interruptPolicy":{"mode":"blend","priority":4},"speech_style":{"speed":1.05,"pitch":0.08,"pause":"playful"},"music":null,"memory_writes":[]}`,
    'Each BEAT must be a single-line JSON object and must appear immediately before the VOICE it controls.',
    'BEAT contains only semantic fields: emotion, intensity, actions, and speech_style. Keep it short so the first VOICE can start quickly.',
    'The VOICE lines must come before CONTROL. Emit the first BEAT and VOICE before planning the full answer. Do not wait for CONTROL before speaking.',
    'Avoid standalone ultra-short VOICE lines like only うん、 あっ、 えへへ、. Attach a few spoken words so each chunk is stable for TTS.',
    'Keep the first VOICE line low-latency; after that, prioritize smooth GPT-SoVITS quality and natural sentence rhythm.',
    'VOICE lines must contain only natural Japanese dialogue. Never put BEAT JSON, stage directions, parenthesized action hints, asterisk actions, action labels, pose descriptions, or JSON in VOICE.',
    'CONTROL must be one JSON object after the CONTROL label. The reply field must exactly match the spoken VOICE text.',
    'Choose 2-5 semantic actions across the turn that match the spoken meaning and mood. Per-BEAT actions may be 1-3 concise semantic actions.',
    'Use only semantic emotion ids and semantic actions. Do not output raw Live2D parameters, VTube Studio parameter ids, expression file names, live2d.parameters, parameterTargets, or pose descriptions.',
    `Good action combos: ${behaviorActionComboPrompt()}.`,
    'Use intensity 0.45-0.85 for normal talking, 0.85-1.0 for punchlines or surprise.',
    'Optional interruptPolicy controls action orchestration: mode blend for normal replies, replace for urgent reactions, protect for a beat that should complete; priority is 0-10.',
    'Optional music controls the song request engine in the final CONTROL only. Use it only when the user explicitly asks for music; otherwise set music to null. Examples: {"action":"request","query":"song title artist"}, {"provider":"netease-cloud","action":"request","query":"song title artist"}, {"provider":"local-library","action":"request","query":"song title artist"}, {"action":"play_next","query":"song title artist"}, {"action":"skip"}, {"action":"pause"}, {"action":"resume"}, {"action":"stop"}, {"action":"queue"}. The runtime may use a local music library, NetEase Cloud Music, or Apple Music; never include tokens, cookies, or credentials.',
    'When the user names NetEase, 网易云, 163, or 云音乐, set final CONTROL music.provider to "netease-cloud". When they explicitly say local file/library, set provider to "local-library". Otherwise omit provider and let Settings choose.',
    'For song requests, always put the executable request in final CONTROL music JSON instead of only saying it in VOICE. For Chinese requests like 点歌, 来一首, or 加歌, use {"action":"request","query":"song title artist"}. For 播放, 放歌, or 给我放, use action play_now. If they ask to put it next, use play_next.',
    'Treat Chinese phrases such as \u6211\u8981\u542c, \u60f3\u542c, \u542c\u4e00\u4e0b, \u542c\u4e00\u9996, \u653e\u4e00\u9996, or \u6765\u4e00\u9996 as explicit music playback requests; use action play_now in final CONTROL unless the user asks to queue or play next.',
    'Only when a durable, low-risk memory is clearly confirmed, include memory_writes items with scope, type, title, text, optional episode, facts, foresight, importance, confidence, and tags. Otherwise use an empty array.',
    'Memory facts must be atomic and verifiable. Foresight must be conservative, evidence-based, and include confidence when useful.',
    'Never propose secrets, API keys, sensitive personal data, raw chat dumps, guesses about a user, or negative personality labels as memory.',
    semanticExpressionPromptCatalog(),
    semanticActionPromptCatalog(),
    'The execution layer maps semantic emotions to expression presets, VTube Studio expressions, and fine motion overlays.'
  ].join('\n');
}

export function readLive2DLLMHistory() {
  const history = readJson(HISTORY_KEY, []);
  return Array.isArray(history) ? history.filter((item) => item && ['user', 'assistant'].includes(item.role)).slice(-8) : [];
}

export function clearLive2DLLMHistory() {
  writeJson(HISTORY_KEY, []);
}

export async function requestLive2DControl(message) {
  const settings = readRoomLLMSettings();
  if (!settings.apiKey || !settings.apiUrl) {
    throw new Error('Missing LLM settings. Configure LLM in Studio Settings first.');
  }

  const history = readLive2DLLMHistory();
  const memoryPrompt = await buildLive2DMemoryPrompt(message);
  const visionContext = await buildLive2DVisionPrompt();
  const systemPrompt = [yachiyoCorePersonalityPrompt(), settings.systemPrompt, memoryPrompt, visionContext.prompt, live2DControlSystemPrompt()].filter(Boolean).join('\n\n');
  let rawReply = '';

  if (settings.useProxy) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversation: history,
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        model: settings.model,
        systemPrompt,
        vision: visionContext.payload
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || `LLM ${response.status}`);
    rawReply = result.data?.reply || '';
  } else {
    const apiUrl = normalizeOpenAIUrl(settings.apiUrl, settings.model, settings.provider);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        ...openRouterHeaders(apiUrl)
      },
      body: JSON.stringify(buildDirectRequestBody({ ...settings, apiUrl }, systemPrompt, history, message, visionContext.payload))
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    rawReply = pickReply(await response.json());
  }

  return finishLive2DControlRequest(message, history, rawReply);
}

export async function requestLive2DControlStream(message, handlers = {}) {
  const settings = readRoomLLMSettings();
  if (!settings.apiKey || !settings.apiUrl) {
    throw new Error('Missing LLM settings. Configure LLM in Studio Settings first.');
  }

  const history = readLive2DLLMHistory();
  const memoryPrompt = await buildLive2DMemoryPrompt(message);
  const visionContext = await buildLive2DVisionPrompt();
  const systemPrompt = [yachiyoCorePersonalityPrompt(), settings.systemPrompt, memoryPrompt, visionContext.prompt, live2DStreamingControlSystemPrompt()].filter(Boolean).join('\n\n');
  const sentenceEmitter = createReplySentenceEmitter(handlers);
  let rawReply = '';

  if (settings.useProxy) {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        conversation: history,
        apiKey: settings.apiKey,
        apiUrl: settings.apiUrl,
        model: settings.model,
        systemPrompt,
        vision: visionContext.payload
      })
    });
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        const fallback = await requestLive2DControl(message);
        sentenceEmitter.flushReply(fallback.reply);
        handlers.onDone?.(fallback);
        return fallback;
      }
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || `LLM ${response.status}`);
    }
    rawReply = await readStreamingTextResponse(response, {
      onText: (delta, accumulated) => {
        sentenceEmitter.pushRaw(accumulated);
        handlers.onDelta?.({ delta, raw: accumulated });
      },
      onEvent: (event) => handlers.onEvent?.(event)
    });
  } else {
    const apiUrl = normalizeOpenAIUrl(settings.apiUrl, settings.model, settings.provider);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        ...openRouterHeaders(apiUrl)
      },
      body: JSON.stringify(buildStreamingDirectRequestBody({ ...settings, apiUrl }, systemPrompt, history, message, visionContext.payload))
    });
    if (!response.ok) throw new Error(`LLM ${response.status}`);
    rawReply = await readStreamingTextResponse(response, {
      onText: (delta, accumulated) => {
        sentenceEmitter.pushRaw(accumulated);
        handlers.onDelta?.({ delta, raw: accumulated });
      },
      onEvent: (event) => handlers.onEvent?.(event)
    });
  }

  sentenceEmitter.pushRaw(rawReply, { flush: true });
  const parsed = finishLive2DControlRequest(message, history, rawReply, sentenceEmitter);
  handlers.onDone?.(parsed);
  return parsed;
}
