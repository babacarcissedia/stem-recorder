#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Build G media cache (filmstrip + waveform peaks).
 * Synthesizes an 8s take, then asserts frame/peak extraction and disk-cache reuse.
 * Usage: node scripts/smoke-thumbs.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.STEM_OUT_ROOT = process.env.STEM_OUT_ROOT || '/tmp/stem-thumbs-smoke';

const { findFfmpeg, runFfmpeg } = require('../lib/node/ffmpeg-util.js');
const { getFilmstrip, getWaveformPeaks, CACHE_DIR } = require('../lib/node/media-cache.js');
const { fromMediaUrl } = require('../lib/node/media-url.js');

async function main() {
  const ffmpeg = findFfmpeg();
  assert.ok(ffmpeg, 'ffmpeg required for this smoke');

  const takeDir = path.join(process.env.STEM_OUT_ROOT, 'take-thumbs');
  fs.rmSync(takeDir, { recursive: true, force: true });
  fs.mkdirSync(takeDir, { recursive: true });

  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x240:rate=15',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    path.join(takeDir, 'screen.mp4'),
  ]);
  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    path.join(takeDir, 'audio.mp3'),
  ]);

  const strip = await getFilmstrip(takeDir, 'screen.mp4');
  assert.ok(strip, 'filmstrip generated');
  assert.strictEqual(strip.intervalSec, 1);
  assert.ok(strip.frames.length >= 7 && strip.frames.length <= 9, `frames ~8, got ${strip.frames.length}`);
  assert.ok(strip.frames[0].startsWith('app://media/'), 'frames are served over the app media protocol');
  assert.strictEqual(fromMediaUrl(strip.frames[0]), path.join(takeDir, CACHE_DIR, 'film-screen', 'frame-00001.jpg'));

  const frameDir = path.join(takeDir, CACHE_DIR, 'film-screen');
  const firstFrame = path.join(frameDir, 'frame-00001.jpg');
  const mtimeBefore = fs.statSync(firstFrame).mtimeMs;
  const again = await getFilmstrip(takeDir, 'screen.mp4');
  assert.strictEqual(again.frames.length, strip.frames.length);
  assert.strictEqual(fs.statSync(firstFrame).mtimeMs, mtimeBefore, 'cache hit must not regenerate frames');

  const wave = await getWaveformPeaks(takeDir);
  assert.ok(wave, 'waveform generated');
  assert.strictEqual(wave.peaksPerSec, 20);
  assert.ok(Math.abs(wave.peaks.length - 8 * 20) <= 25, `~160 peaks, got ${wave.peaks.length}`);
  assert.ok(wave.peaks.every((p) => p >= 0 && p <= 1), 'peaks normalized 0..1');
  // lavfi sine encodes at ~0.12 amplitude — assert audible, not full-scale.
  assert.ok(Math.max(...wave.peaks) > 0.05, 'sine tone should produce audible peaks');

  const cachePath = path.join(takeDir, CACHE_DIR, 'audio-peaks.json');
  const peaksMtime = fs.statSync(cachePath).mtimeMs;
  const waveAgain = await getWaveformPeaks(takeDir);
  assert.strictEqual(waveAgain.peaks.length, wave.peaks.length);
  assert.strictEqual(fs.statSync(cachePath).mtimeMs, peaksMtime, 'cache hit must not rewrite peaks');

  // Source change invalidates the filmstrip cache.
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(takeDir, 'screen.mp4'), future, future);
  await getFilmstrip(takeDir, 'screen.mp4');
  assert.notStrictEqual(fs.statSync(firstFrame).mtimeMs, mtimeBefore, 'stale cache must regenerate');

  console.log(JSON.stringify({
    ok: true,
    frames: strip.frames.length,
    peaks: wave.peaks.length,
    cacheDir: path.join(takeDir, CACHE_DIR),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
