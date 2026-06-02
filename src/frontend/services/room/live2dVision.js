import {
  canAttachRoomLLMVisionImage,
  readRoomLLMSettings,
  readRoomVisionSettings
} from './roomSettings';

function asText(value, maxLength = 240) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function rectText(rect = {}) {
  const width = Number(rect.width) || 0;
  const height = Number(rect.height) || 0;
  if (!width || !height) return '';
  return `${Math.round(Number(rect.x) || 0)},${Math.round(Number(rect.y) || 0)} ${Math.round(width)}x${Math.round(height)}`;
}

function windowLine(label, windowInfo = {}) {
  if (!windowInfo?.available) return `${label}: unavailable`;
  const title = asText(windowInfo.title || '(untitled)', 160);
  const processName = asText(windowInfo.processName || '', 80);
  const className = asText(windowInfo.className || '', 80);
  const bounds = rectText(windowInfo.bounds);
  return `${label}: ${title}${processName ? ` | app=${processName}` : ''}${className ? ` | class=${className}` : ''}${bounds ? ` | bounds=${bounds}` : ''}`;
}

function buildVisionContextLines(context = {}, imageAttached = false) {
  const cursor = context.cursor || {};
  const lines = [
    'Desktop visual context:',
    `Captured at: ${asText(context.capturedAt || '', 80) || 'unknown'}`,
    `Cursor: x=${Math.round(Number(cursor.x) || 0)}, y=${Math.round(Number(cursor.y) || 0)}`,
    windowLine('Window under cursor', context.pointerWindow),
    windowLine('Foreground window', context.foregroundWindow)
  ];
  if (context.redacted) {
    lines.push(`Screenshot redacted: ${asText(context.redactionReason || 'sensitive-window', 120)}`);
  } else if (context.image?.cursorCropBase64 && imageAttached) {
    const crop = rectText(context.image.cursorCropRect);
    lines.push(`Attached image: cursor-neighborhood screenshot${crop ? `, crop=${crop}` : ''}. The pink crosshair marks the mouse pointer.`);
  } else if (context.image?.cursorCropBase64) {
    const crop = rectText(context.image.cursorCropRect);
    lines.push(`Screenshot available but not attached for this LLM provider${crop ? `, crop=${crop}` : ''}.`);
  } else {
    lines.push('Attached image: unavailable.');
  }
  lines.push('Use this only as current desktop grounding. If the screenshot is ambiguous, say what you are uncertain about.');
  return lines;
}

export function formatLive2DVisionPrompt(context = {}, settings = {}, llmSettings = {}) {
  if (!context?.enabled) return { prompt: '', payload: null };
  const imageBase64 = context.redacted ? '' : String(context.image?.cursorCropBase64 || '').trim();
  const attachImage = canAttachRoomLLMVisionImage(llmSettings);
  const lines = buildVisionContextLines(context, Boolean(imageBase64) && Boolean(settings.includeScreenshot) && attachImage);
  const prompt = lines.join('\n').slice(0, Number(settings.maxPromptChars) || 1600);
  const payload = imageBase64 && settings.includeScreenshot && attachImage
    ? {
        includeImage: true,
        imageBase64,
        mimeType: context.image?.mimeType || 'image/png',
        detail: settings.detail || 'low'
      }
    : null;
  return { prompt, payload };
}

export async function readLive2DVisionContext(settingsOverrides = {}) {
  const settings = {
    ...readRoomVisionSettings(),
    ...(settingsOverrides || {})
  };
  if (!settings.enabled) return { success: true, enabled: false };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2600);
  try {
    const response = await fetch('/api/vision/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        enabled: settings.enabled,
        includeImages: settings.includeScreenshot,
        sendScreenshot: settings.includeScreenshot,
        includeFullScreen: settings.includeFullScreen,
        cropSize: settings.cropSize
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.message || `Vision ${response.status}`);
    return result;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function buildLive2DVisionPrompt(settingsOverrides = {}) {
  const settings = {
    ...readRoomVisionSettings(),
    ...(settingsOverrides || {})
  };
  if (!settings.enabled) return { prompt: '', payload: null, context: null };
  const llmSettings = readRoomLLMSettings();
  try {
    const context = await readLive2DVisionContext({
      ...settings,
      includeScreenshot: settings.includeScreenshot && canAttachRoomLLMVisionImage(llmSettings)
    });
    const { prompt, payload } = formatLive2DVisionPrompt(context, settings, llmSettings);
    return { prompt, payload, context };
  } catch (_) {
    return { prompt: '', payload: null, context: null };
  }
}
