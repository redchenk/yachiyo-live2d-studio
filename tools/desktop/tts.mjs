export function buildTtsRequest(input) {
  if (!String(input.text || '').trim()) throw new Error('TTS text is required');
  const headers = { 'Content-Type': 'application/json' };
  if (!input.provider || input.provider === 'gpt-sovits') {
    return { url: input.apiUrl || 'http://127.0.0.1:9880/tts', headers, body: { text: input.text, text_lang: 'ja', ref_audio_path: input.refAudioPath || input.voice, prompt_text: input.promptText || '', prompt_lang: 'ja', streaming_mode: true, media_type: 'wav', batch_size: 1, parallel_infer: false, text_split_method: 'cut5' } };
  }
  if (input.provider === 'mimo') {
    headers['api-key'] = input.apiKey || '';
    return { url: input.apiUrl || 'https://api.xiaomimimo.com/v1/chat/completions', headers, body: { model: input.model || 'mimo-v2.5-tts', messages: [{ role: 'user', content: `Read only the following Japanese text naturally.${input.emotion ? ` Use a ${input.emotion} delivery.` : ''}` }, { role: 'assistant', content: input.text }], modalities: ['audio'], audio: { format: 'wav', voice: input.voice || 'mimo_default' } } };
  }
  headers.Authorization = `Bearer ${input.apiKey || ''}`;
  return { url: input.apiUrl || 'https://api.openai.com/v1/audio/speech', headers, body: { model: input.model || 'tts-1', input: input.text, voice: input.voice || 'alloy', response_format: 'mp3', speed: Math.min(1.25, Math.max(0.75, Number(input.speechStyle?.speed) || 1)) } };
}

export function audioBase64(data) {
  const audio = data?.choices?.[0]?.message?.audio?.data || data?.audio?.data || data?.data?.audio?.data || data?.audio || data?.data?.audio || data?.audio_base64;
  if (typeof audio !== 'string' || !audio) throw new Error('TTS provider did not return audio');
  return Buffer.from(audio.replace(/^data:[^,]+,/, ''), 'base64');
}
