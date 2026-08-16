'use strict';

/**
 * Local Whisper via scripts/hf-whisper-transcribe.py (Hugging Face
 * transformers, run in a subprocess). No cloud fallback — errors surface
 * verbatim to the caller. The Python side writes transcript.txt /
 * captions.vtt / asr.json directly; invoke() returns its file-path summary
 * unchanged so lib/transcribe.js can layer verification on top.
 */

const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { appRoot } = require('../../app-root.js');

const DEFAULT_MODEL = 'openai/whisper-large-v3';
function cliScript() {
  return path.join(appRoot(), 'scripts', 'hf-whisper-transcribe.py');
}

function findPython() {
  const root = appRoot();
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

/** ctx: { audio: {path, sourceFile}, model, language, editDir } */
async function invoke({
  audio, model, language, editDir,
} = {}) {
  const python = findPython();
  if (!python) {
    throw new Error('local ASR needs Python 3 (python3 not found) — install it, or use cloud this once');
  }
  const args = [
    cliScript(), audio.path,
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
  return summary;
}

module.exports = {
  id: 'local',
  label: 'Local Whisper (Hugging Face)',
  wordTimestamps: true,
  languages: 'auto',
  relativeSpeed: 'slow',
  invoke,
  findPython,
  asrStatus,
  DEFAULT_MODEL,
};
