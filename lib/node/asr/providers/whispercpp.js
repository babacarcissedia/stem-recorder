'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function firstExecutable(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 20000 });
    if (result.status === 0) return candidate;
  }
  return null;
}

function findWhisperCli() {
  if (process.env.STEM_ASR_WHISPERCPP_BIN) {
    return firstExecutable([process.env.STEM_ASR_WHISPERCPP_BIN]);
  }
  return firstExecutable([
    'whisper-cli',
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli',
  ]);
}

function findModel() {
  const configured = process.env.STEM_ASR_WHISPERCPP_MODEL;
  return configured && fs.existsSync(configured) ? configured : null;
}

function versionOf(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) return null;
  return `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n').find((line) => /whisper/i.test(line)) || null;
}

function status() {
  const binary = findWhisperCli();
  const model = findModel();
  return {
    available: Boolean(binary && model),
    binary,
    model,
    version: binary ? versionOf(binary) : null,
  };
}

function millis(offsets, key, label) {
  const value = Number(offsets && offsets[key]);
  if (!Number.isFinite(value)) throw new Error(`whisper.cpp token is missing ${label} timing`);
  return value / 1000;
}

function isSpecialToken(text) {
  return /^\[_.*\]$/.test(text.trim());
}

function normalizeWords(transcription) {
  const words = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    current.word = current.word.trim();
    if (current.word) words.push(current);
    current = null;
  };

  for (const segment of transcription) {
    for (const token of Array.isArray(segment.tokens) ? segment.tokens : []) {
      const raw = String(token.text || '');
      if (!raw.trim() || isSpecialToken(raw)) continue;
      const start = millis(token.offsets, 'from', 'start');
      const end = millis(token.offsets, 'to', 'end');
      if (raw.startsWith(' ')) {
        flush();
        current = { word: raw.trimStart(), start, end };
      } else if (current) {
        current.word += raw;
        current.end = Math.max(current.end, end);
      } else {
        current = { word: raw, start, end };
      }
    }
    flush();
  }
  return words;
}

function normalizeWhisperCppJson(raw) {
  const transcription = Array.isArray(raw && raw.transcription) ? raw.transcription : [];
  const cues = transcription.map((segment) => ({
    start: millis(segment.offsets, 'from', 'segment start'),
    end: millis(segment.offsets, 'to', 'segment end'),
    text: String(segment.text || '').trim(),
  })).filter((cue) => cue.text);

  return {
    model: raw?.model?.type || path.basename(String(raw?.params?.model || 'whisper.cpp')),
    language: raw?.result?.language || raw?.params?.language || null,
    text: cues.map((cue) => cue.text).join('\n'),
    cues,
    words: normalizeWords(transcription),
  };
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function buildArgs({ model, audioPath, language, outputPrefix }) {
  return [
    '--model', model,
    '--file', audioPath,
    '--language', language || 'auto',
    '--max-context', '0',
    '--output-json-full',
    '--output-file', outputPrefix,
    '--no-prints',
  ];
}

async function invoke({ audio, language, editDir } = {}) {
  const ready = status();
  if (!ready.binary) {
    throw new Error('whisper.cpp ASR needs whisper-cli — set STEM_ASR_WHISPERCPP_BIN or install whisper.cpp');
  }
  if (!ready.model) {
    throw new Error('whisper.cpp ASR needs a model file — set STEM_ASR_WHISPERCPP_MODEL');
  }

  fs.mkdirSync(editDir, { recursive: true });
  const prefix = path.join(editDir, `.whispercpp-${process.pid}-${Date.now()}`);
  const args = buildArgs({
    model: ready.model,
    audioPath: audio.path,
    language,
    outputPrefix: prefix,
  });
  const result = await run(ready.binary, args);
  const jsonPath = `${prefix}.json`;
  if (result.code !== 0 || !fs.existsSync(jsonPath)) {
    const detail = result.stderr.trim().split('\n').slice(-8).join('\n') || `exit ${result.code}`;
    throw new Error(`whisper.cpp transcribe failed: ${detail}`);
  }

  try {
    const normalized = normalizeWhisperCppJson(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    return {
      ...normalized,
      provenance: {
        binary: ready.binary,
        version: ready.version,
        modelFile: ready.model,
      },
    };
  } finally {
    fs.rmSync(jsonPath, { force: true });
  }
}

module.exports = {
  id: 'whispercpp',
  label: 'Local Whisper (whisper.cpp)',
  wordTimestamps: true,
  languages: 'auto',
  relativeSpeed: 'fast',
  invoke,
  status,
  findWhisperCli,
  findModel,
  buildArgs,
  normalizeWhisperCppJson,
};
