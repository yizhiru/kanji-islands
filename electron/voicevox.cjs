const baseURL = 'http://127.0.0.1:50021';
const speaker = 2; // 四国めたん・ノーマル
const maxAudioBytes = 16 * 1024 * 1024;

async function request(path, options = {}) {
  const response = await fetch(baseURL + path, { ...options, redirect: 'error' });
  if (!response.ok) throw new Error('VOICEVOX request failed');
  return response;
}

async function isAvailable() {
  try {
    const response = await request('/speakers', { signal: AbortSignal.timeout(2000) });
    const speakers = await response.json();
    return speakers.some(
      (voice) =>
        voice.name === '四国めたん' &&
        voice.styles?.some((style) => style.id === speaker && style.name === 'ノーマル'),
    );
  } catch {
    return false;
  }
}

async function synthesize(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 500)
    throw new Error('Invalid text for VOICEVOX');
  const signal = AbortSignal.timeout(20_000);
  const query = await request('/audio_query?' + new URLSearchParams({ text, speaker }), {
    method: 'POST',
    signal,
  });
  const audioQuery = await query.json();
  audioQuery.speedScale = 0.9;
  const audio = await request('/synthesis?' + new URLSearchParams({ speaker }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(audioQuery),
    signal,
  });
  const reader = audio.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxAudioBytes) throw new Error('VOICEVOX audio is too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const wav = Buffer.concat(chunks, length);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Invalid VOICEVOX audio');
  return wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength);
}

module.exports = { isAvailable, synthesize };
