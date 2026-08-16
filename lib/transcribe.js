'use strict';

/**
 * Transcribe a take's audio stem: local Whisper (Hugging Face via Python) by
 * default, or the Traxelio cloud ASR endpoint, resolved through the ASR
 * provider registry (lib/asr/registry.js — one file per provider under
 * lib/asr/providers/). Never falls back silently between providers.
 * Outputs land in <take>/edit/: transcript.txt, captions.vtt, captions.srt, asr.json.
 *
 * Every run is verified (lib/asr/verify.js) before being handed back: a
 * decoder that loops on a filler word exits 0 and writes a complete-looking
 * transcript, so completion alone is not proof of a good result.
 */

const fs = require('fs');
const path = require('path');
const { findFfmpeg, runFfmpeg, probeDuration } = require('./ffmpeg-util');
const registry = require('./asr/registry');
const { verifyTranscript } = require('./asr/verify');
const { buildSrt } = require('./captions');

const localProvider = registry.get('local');
const { DEFAULT_MODEL, findPython, asrStatus } = localProvider;

/**
 * Pick the audio to transcribe: prefer audio.mp3, else demux screen.mp4
 * into edit/.asr-audio.mp3 with ffmpeg.
 */
async function resolveAudio(takeDir) {
  const mp3 = path.join(takeDir, 'audio.mp3');
  if (fs.existsSync(mp3)) return { path: mp3, demuxed: false, sourceFile: 'audio.mp3' };

  const screen = path.join(takeDir, 'screen.mp4');
  if (!fs.existsSync(screen)) throw new Error('no audio.mp3 or screen.mp4 in this take');
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg needed to extract audio from screen.mp4');

  const editDir = path.join(takeDir, 'edit');
  fs.mkdirSync(editDir, { recursive: true });
  const out = path.join(editDir, '.asr-audio.mp3');
  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y', '-i', screen,
    '-vn', '-c:a', 'libmp3lame', '-b:a', '128k',
    out,
  ]);
  return { path: out, demuxed: true, sourceFile: 'screen.mp4' };
}

/**
 * Verify one run's cues against the source audio's real duration, then
 * merge the result into asr.json on disk (so it survives a later reload —
 * readTranscript() returns it as part of `asr`) and return it for the
 * caller to inspect immediately. Never throws: a verification failure is a
 * flag on an otherwise-usable result, not a reason to discard it — see
 * lib/asr/verify.js for why.
 */
function attachVerification({ cues, audioPath, asrPath }) {
  const duration = probeDuration(audioPath);
  const verification = verifyTranscript(cues, duration);
  try {
    const meta = JSON.parse(fs.readFileSync(asrPath, 'utf8'));
    meta.verification = verification;
    fs.writeFileSync(asrPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  } catch {
    /* asr.json missing/corrupt — verification still returned in-memory below */
  }
  return verification;
}

/** Local Whisper, resolved through the ASR registry. No cloud fallback. */
async function runLocal({ takeDir, model, language } = {}) {
  const audio = await resolveAudio(takeDir);
  const editDir = path.join(takeDir, 'edit');
  fs.mkdirSync(editDir, { recursive: true });

  const summary = await localProvider.invoke({
    audio, model, language, editDir,
  });
  const cues = parseVttCues(fs.readFileSync(summary.captions, 'utf8'));
  const captionsSrt = path.join(editDir, 'captions.srt');
  fs.writeFileSync(captionsSrt, buildSrt(cues), 'utf8');
  const verification = attachVerification({ cues, audioPath: audio.path, asrPath: summary.asr });
  return {
    provider: 'local', ...summary, captionsSrt, verification, audio: audio.path,
  };
}

/** Cloud ASR, resolved through the ASR registry (Bearer STEM_ASR_TOKEN). */
async function runCloud({ takeDir, token, url } = {}) {
  const audio = await resolveAudio(takeDir);
  const cloudProvider = registry.get('cloud');
  const raw = await cloudProvider.invoke({
    audio, token, url, helpers: { parseVttCues },
  });

  const files = writeOutputs(takeDir, {
    provider: 'cloud',
    model: raw.model,
    language: raw.language,
    sourceFile: audio.sourceFile,
    text: raw.text,
    cues: raw.cues,
  });
  const verification = attachVerification({ cues: raw.cues, audioPath: audio.path, asrPath: files.asr });
  return {
    provider: 'cloud', ok: true, ...files, verification, audio: audio.path,
  };
}

function fmtVttTime(t) {
  const totalMs = Math.max(0, Math.round(Number(t) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function buildVtt(cues) {
  const lines = ['WEBVTT', ''];
  for (const cue of cues) {
    lines.push(`${fmtVttTime(cue.start)} --> ${fmtVttTime(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  }
  return lines.join('\n');
}

function parseVttTime(str) {
  const m = String(str).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Parse WEBVTT → [{start, end, text}] (seconds). Ignores headers/NOTEs. */
function parseVttCues(vtt) {
  const cues = [];
  const blocks = String(vtt).replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length || /^WEBVTT/.test(lines[0]) || /^NOTE/.test(lines[0])) continue;
    let i = 0;
    if (!lines[i].includes('-->') && lines[i + 1] && lines[i + 1].includes('-->')) i = 1;
    if (!lines[i] || !lines[i].includes('-->')) continue;
    const [rawStart, rawEnd] = lines[i].split('-->');
    const start = parseVttTime(rawStart);
    const end = parseVttTime(String(rawEnd || '').trim().split(/\s+/)[0]);
    if (start == null || end == null) continue;
    const text = lines.slice(i + 1).join('\n').trim();
    if (text) cues.push({ start, end, text });
  }
  return cues;
}

function writeOutputs(takeDir, { provider, model, language, sourceFile, text, cues }) {
  const editDir = path.join(takeDir, 'edit');
  fs.mkdirSync(editDir, { recursive: true });
  const transcript = path.join(editDir, 'transcript.txt');
  const captions = path.join(editDir, 'captions.vtt');
  const captionsSrt = path.join(editDir, 'captions.srt');
  const asr = path.join(editDir, 'asr.json');
  fs.writeFileSync(transcript, `${text.trim()}\n`, 'utf8');
  fs.writeFileSync(captions, buildVtt(cues), 'utf8');
  fs.writeFileSync(captionsSrt, buildSrt(cues), 'utf8');
  fs.writeFileSync(asr, `${JSON.stringify({
    provider,
    model,
    language,
    createdAt: new Date().toISOString(),
    sourceFile,
  }, null, 2)}\n`, 'utf8');
  return {
    transcript, captions, captionsSrt, asr, segments: cues.length,
  };
}

/**
 * Edit-T2d: where Apply finds captions to burn. burn=false when the take
 * never opted in; burn=true with a vtt path when captions.vtt exists; and
 * skipped (burn=false + reason) when the flag is on but the file is missing —
 * Apply proceeds without captions instead of failing.
 */
function resolveBurn(takeDir, manifest) {
  if (!manifest || !manifest.captions || manifest.captions.burn !== true) {
    return { burn: false, requested: false };
  }
  const vtt = path.join(takeDir, 'edit', 'captions.vtt');
  if (!fs.existsSync(vtt)) {
    return { burn: false, requested: true, skipped: 'no captions.vtt — run Transcribe first' };
  }
  return { burn: true, requested: true, vtt };
}

/**
 * Edit-T2d light caption edit: replace one cue's text and rewrite
 * captions.vtt (transcript.txt is rebuilt from the cues so both stay in
 * sync). Cue timing is untouched.
 */
function updateCueText(takeDir, index, text) {
  const captions = path.join(takeDir, 'edit', 'captions.vtt');
  if (!fs.existsSync(captions)) throw new Error('no captions.vtt to edit — run Transcribe first');
  const cues = parseVttCues(fs.readFileSync(captions, 'utf8'));
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= cues.length) throw new Error(`cue index out of range: ${index}`);
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('cue text cannot be empty');
  cues[i] = { ...cues[i], text: clean };
  fs.writeFileSync(captions, buildVtt(cues), 'utf8');
  const captionsSrt = path.join(takeDir, 'edit', 'captions.srt');
  fs.writeFileSync(captionsSrt, buildSrt(cues), 'utf8');
  const transcript = path.join(takeDir, 'edit', 'transcript.txt');
  fs.writeFileSync(transcript, `${cues.map((c) => c.text).join('\n')}\n`, 'utf8');
  return {
    captions, captionsSrt, transcript, segments: cues.length, cue: cues[i],
  };
}

/** Read existing transcript files; null when none exist. */
function readTranscript(takeDir) {
  const editDir = path.join(takeDir, 'edit');
  const transcript = path.join(editDir, 'transcript.txt');
  const captions = path.join(editDir, 'captions.vtt');
  const asrPath = path.join(editDir, 'asr.json');
  if (!fs.existsSync(captions) && !fs.existsSync(transcript)) return null;
  let asr = null;
  if (fs.existsSync(asrPath)) {
    try {
      asr = JSON.parse(fs.readFileSync(asrPath, 'utf8'));
    } catch {
      /* corrupt asr.json — still return the text */
    }
  }
  return {
    text: fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '',
    cues: fs.existsSync(captions) ? parseVttCues(fs.readFileSync(captions, 'utf8')) : [],
    asr,
  };
}

module.exports = {
  DEFAULT_MODEL,
  findPython,
  asrStatus,
  resolveAudio,
  runLocal,
  runCloud,
  parseVttCues,
  buildVtt,
  writeOutputs,
  readTranscript,
  resolveBurn,
  updateCueText,
};
