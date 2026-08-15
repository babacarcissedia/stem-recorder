'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { findFfmpeg, runFfmpeg, probeDuration } = require('./ffmpeg-util');

const CACHE_DIR = 'edit/.cache';
const THUMB_HEIGHT = 54;
const MAX_FRAMES = 1200;
const PEAKS_PER_SEC = 20;
const PCM_RATE = 8000;

function sourceStamp(srcPath) {
  const st = fs.statSync(srcPath);
  return `${st.size}:${Math.round(st.mtimeMs)}`;
}

function readMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Sampled filmstrip frames for a video stem, cached on disk under
 * edit/.cache/film-<stem>/. Regenerates only when the source file changes.
 * Returns { intervalSec, frames: [file URLs] } or null when unavailable.
 */
async function getFilmstrip(takeDir, stemFile) {
  const srcPath = path.join(takeDir, stemFile);
  if (!fs.existsSync(srcPath)) return null;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return null;

  const duration = probeDuration(srcPath);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const intervalSec = Math.max(1, Math.ceil(duration / MAX_FRAMES));

  const dir = path.join(takeDir, CACHE_DIR, `film-${stemFile.replace(/\.[^.]+$/, '')}`);
  const metaPath = path.join(dir, 'meta.json');
  const stamp = sourceStamp(srcPath);
  const meta = readMeta(metaPath);

  if (!meta || meta.stamp !== stamp || meta.intervalSec !== intervalSec) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await runFfmpeg(ffmpeg, [
      '-hide_banner', '-y', '-i', srcPath,
      '-vf', `fps=1/${intervalSec},scale=-2:${THUMB_HEIGHT}`,
      '-q:v', '5',
      path.join(dir, 'frame-%05d.jpg'),
    ]);
    fs.writeFileSync(metaPath, JSON.stringify({ stamp, intervalSec, height: THUMB_HEIGHT }), 'utf8');
  }

  const frames = fs.readdirSync(dir)
    .filter((f) => /^frame-\d+\.jpg$/.test(f))
    .sort()
    .map((f) => pathToFileURL(path.join(dir, f)).href);
  return frames.length ? { intervalSec, frames } : null;
}

function decodePcmPeaks(ffmpeg, srcPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-hide_banner', '-v', 'error', '-i', srcPath,
      '-vn', '-ac', '1', '-ar', String(PCM_RATE), '-f', 's16le', '-',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const samplesPerPeak = Math.floor(PCM_RATE / PEAKS_PER_SEC);
    const peaks = [];
    let bucketMax = 0;
    let bucketCount = 0;
    let carry = null;
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.stdout.on('data', (chunk) => {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > bucketMax) bucketMax = v;
        bucketCount += 1;
        if (bucketCount >= samplesPerPeak) {
          peaks.push(Math.round((bucketMax / 32768) * 1000) / 1000);
          bucketMax = 0;
          bucketCount = 0;
        }
      }
      carry = usable < buf.length ? buf.subarray(usable) : null;
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `ffmpeg exit ${code}`));
        return;
      }
      if (bucketCount > 0) peaks.push(Math.round((bucketMax / 32768) * 1000) / 1000);
      resolve(peaks);
    });
  });
}

/**
 * Peak envelope for audio.mp3, cached at edit/.cache/audio-peaks.json.
 * Returns { peaksPerSec, peaks: [0..1] } or null when unavailable.
 */
async function getWaveformPeaks(takeDir, stemFile = 'audio.mp3') {
  const srcPath = path.join(takeDir, stemFile);
  if (!fs.existsSync(srcPath)) return null;
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return null;

  const dir = path.join(takeDir, CACHE_DIR);
  const cachePath = path.join(dir, 'audio-peaks.json');
  const stamp = sourceStamp(srcPath);
  const cached = readMeta(cachePath);
  if (cached && cached.stamp === stamp && Array.isArray(cached.peaks)) {
    return { peaksPerSec: cached.peaksPerSec, peaks: cached.peaks };
  }

  const peaks = await decodePcmPeaks(ffmpeg, srcPath);
  if (!peaks.length) return null;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ stamp, peaksPerSec: PEAKS_PER_SEC, peaks }), 'utf8');
  return { peaksPerSec: PEAKS_PER_SEC, peaks };
}

module.exports = { getFilmstrip, getWaveformPeaks, CACHE_DIR };
