'use strict';

/**
 * Traxelio cloud ASR endpoint (Bearer STEM_ASR_TOKEN). Returns raw
 * { model, language, text, cues } — no word timestamps, no file I/O;
 * lib/transcribe.js writes transcript.txt / captions.vtt / asr.json and
 * layers verification on top the same way it does for every provider.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://asr.traxelio.com/transcribe';

/** ctx: { audio: {path}, token, url, helpers: { parseVttCues } } */
async function invoke({
  audio, token, url, helpers,
} = {}) {
  const endpoint = url || process.env.STEM_ASR_URL || DEFAULT_URL;
  const auth = token || process.env.STEM_ASR_TOKEN;
  if (!auth) throw new Error('cloud transcribe needs STEM_ASR_TOKEN');

  const form = new FormData();
  form.append(
    'file',
    new Blob([fs.readFileSync(audio.path)], { type: 'audio/mpeg' }),
    path.basename(audio.path)
  );
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}` },
    body: form,
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`cloud ASR ${res.status}: ${body || res.statusText}`);
  }
  const data = await res.json();

  const cues = Array.isArray(data.segments)
    ? data.segments
      .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text || '').trim() }))
      .filter((c) => c.text)
    : (data.vtt ? helpers.parseVttCues(data.vtt) : []);
  const text = String(data.text || data.transcript || cues.map((c) => c.text).join('\n')).trim();

  return {
    model: data.model || 'traxelio-asr',
    language: data.language || null,
    text,
    cues,
  };
}

module.exports = {
  id: 'cloud',
  label: 'Traxelio Cloud ASR',
  wordTimestamps: false,
  languages: 'auto',
  relativeSpeed: 'fast',
  invoke,
  DEFAULT_URL,
};
