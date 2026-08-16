'use strict';

/**
 * Transcribe a take's audio stem: local Whisper (Hugging Face via Python) by
 * default, or the Traxelio cloud ASR endpoint. Never falls back silently.
 * Outputs land in <take>/edit/: transcript.txt, captions.vtt, asr.json.
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { findFfmpeg, runFfmpeg } = require('./ffmpeg-util');

const DEFAULT_MODEL = 'openai/whisper-large-v3';
const DEFAULT_CLOUD_URL = 'https://asr.traxelio.com/transcribe';
const CLI_SCRIPT = path.join(__dirname, '..', 'scripts', 'hf-whisper-transcribe.py');

function findPython() {
  const root = path.join(__dirname, '..');
  const candidates = [
    process.env.STEM_ASR_PYTHON,
    path.join(root, '.venv-asr', 'bin', 'python'),
    path.join(root, '.venv', 'bin', 'python'),
    'python3',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

function asrStatus() {
  const python = findPython();
  if (!python) return { localPythonOk: false, hasTransformers: false, python: null };
  const r = spawnSync(python, ['-c', 'import transformers'], { encoding: 'utf8', timeout: 20000 });
  return { localPythonOk: true, hasTransformers: r.status === 0, python };
}

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

function runPython(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function lastJsonLine(text) {
  const lines = String(text).trim().split('\n').reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      return JSON.parse(s);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Local Whisper via scripts/hf-whisper-transcribe.py. No cloud fallback. */
async function runLocal({ takeDir, model, language } = {}) {
  const python = findPython();
  if (!python) {
    throw new Error('local ASR needs Python 3 (python3 not found) — install it, or use cloud this once');
  }
  const audio = await resolveAudio(takeDir);
  const editDir = path.join(takeDir, 'edit');
  fs.mkdirSync(editDir, { recursive: true });

  const args = [
    CLI_SCRIPT, audio.path,
    '--out-dir', editDir,
    '--model', model || process.env.STEM_ASR_WHISPER_MODEL || DEFAULT_MODEL,
    '--source-name', audio.sourceFile,
  ];
  if (language) args.push('--language', language);

  const { code, stdout, stderr } = await runPython(python, args);
  const summary = lastJsonLine(stdout);
  if (code !== 0 || !summary || summary.ok === false) {
    const detail = (summary && summary.error)
      || stderr.trim().split('\n').slice(-6).join('\n')
      || `python exit ${code}`;
    const hint = /transformers|torch|no module named/i.test(detail)
      ? ' — install with: pip3 install transformers torch — or use cloud this once'
      : '';
    throw new Error(`local transcribe failed: ${detail}${hint}`);
  }
  return { provider: 'local', ...summary, audio: audio.path };
}

/** Cloud ASR: POST the audio to asr.traxelio.com (Bearer STEM_ASR_TOKEN). */
async function runCloud({ takeDir, token, url } = {}) {
  const endpoint = url || process.env.STEM_ASR_URL || DEFAULT_CLOUD_URL;
  const auth = token || process.env.STEM_ASR_TOKEN;
  if (!auth) throw new Error('cloud transcribe needs STEM_ASR_TOKEN');

  const audio = await resolveAudio(takeDir);
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
    : (data.vtt ? parseVttCues(data.vtt) : []);
  const text = String(data.text || data.transcript || cues.map((c) => c.text).join('\n')).trim();

  const files = writeOutputs(takeDir, {
    provider: 'cloud',
    model: data.model || 'traxelio-asr',
    language: data.language || null,
    sourceFile: audio.sourceFile,
    text,
    cues,
  });
  return { provider: 'cloud', ok: true, ...files, audio: audio.path };
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
  const asr = path.join(editDir, 'asr.json');
  fs.writeFileSync(transcript, `${text.trim()}\n`, 'utf8');
  fs.writeFileSync(captions, buildVtt(cues), 'utf8');
  fs.writeFileSync(asr, `${JSON.stringify({
    provider,
    model,
    language,
    createdAt: new Date().toISOString(),
    sourceFile,
  }, null, 2)}\n`, 'utf8');
  return { transcript, captions, asr, segments: cues.length };
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
  const transcript = path.join(takeDir, 'edit', 'transcript.txt');
  fs.writeFileSync(transcript, `${cues.map((c) => c.text).join('\n')}\n`, 'utf8');
  return { captions, transcript, segments: cues.length, cue: cues[i] };
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
