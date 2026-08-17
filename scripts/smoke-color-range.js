#!/usr/bin/env node
'use strict';

/**
 * Ingest already inherits tv/bt709 tags with no color flags at all, so this
 * pins data range vs tag, not tag presence: ingest must remap full-range
 * decoded pixels into the tagged limited range, and export must hold that
 * range through re-encode without remapping it a second time. Synthetic
 * lavfi sources did not reproduce the mismatch reliably across ffmpeg's
 * range-negotiation heuristics, so this runs against a real captured stem
 * (STEM_COLOR_SMOKE_SRC, or the first screen.mp4 under STEM_OUT_ROOT) and
 * skips when none is available, same pattern as smoke:apply.
 *
 * Usage: node scripts/smoke-color-range.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { findFfmpeg, findFfprobe, runFfmpeg, applyClips } = require('../lib/node/ffmpeg-util.js');

function probeColorTags(ffprobeBin, filePath) {
  const r = require('child_process').spawnSync(ffprobeBin, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=color_range,color_space,color_primaries,color_transfer',
    '-of', 'default=noprint_wrappers=1', filePath,
  ], { encoding: 'utf8' });
  const tags = {};
  for (const line of r.stdout.trim().split('\n')) {
    const [k, v] = line.split('=');
    tags[k] = v;
  }
  return tags;
}

function probeLumaRange(ffprobeBin, filePath) {
  const r = require('child_process').spawnSync(ffprobeBin, [
    '-v', 'error', '-f', 'lavfi', '-i', `movie='${filePath}',signalstats`,
    '-show_entries', 'frame_tags=lavfi.signalstats.YMIN,lavfi.signalstats.YMAX',
    '-of', 'csv=p=0',
  ], { encoding: 'utf8' });
  let min = 255;
  let max = 0;
  for (const line of r.stdout.trim().split('\n')) {
    if (!line) continue;
    const [ymin, ymax] = line.split(',').map(Number);
    if (ymin < min) min = ymin;
    if (ymax > max) max = ymax;
  }
  return { min, max };
}

function findScreenSource(root) {
  if (!root || !fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root)) {
    const candidate = path.join(root, entry, 'screen.mp4');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findRealSource({
  colorSmokeSource = process.env.STEM_COLOR_SMOKE_SRC,
  outRoot = process.env.STEM_OUT_ROOT,
  homeRoot = path.join(os.homedir(), 'Movies', 'stem-recorder'),
} = {}) {
  if (colorSmokeSource && fs.existsSync(colorSmokeSource)) return colorSmokeSource;
  return findScreenSource(outRoot) ?? findScreenSource(homeRoot);
}

function selfTest() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'color-range-source-test-'));
  const outSource = path.join(workDir, 'out', 'take-out', 'screen.mp4');
  const homeSource = path.join(workDir, 'home', 'take-home', 'screen.mp4');
  const explicitSource = path.join(workDir, 'explicit.mp4');

  try {
    fs.mkdirSync(path.dirname(outSource), { recursive: true });
    fs.mkdirSync(path.dirname(homeSource), { recursive: true });
    fs.writeFileSync(outSource, 'out');
    fs.writeFileSync(homeSource, 'home');
    fs.writeFileSync(explicitSource, 'explicit');

    assert.strictEqual(
      findRealSource({ outRoot: path.join(workDir, 'out'), homeRoot: path.join(workDir, 'home') }),
      outSource,
      'STEM_OUT_ROOT source must precede the home-directory fallback'
    );
    assert.strictEqual(
      findRealSource({ colorSmokeSource: explicitSource, outRoot: path.join(workDir, 'out'), homeRoot: path.join(workDir, 'home') }),
      explicitSource,
      'STEM_COLOR_SMOKE_SRC must override STEM_OUT_ROOT'
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  selfTest();

  const ffmpeg = findFfmpeg();
  const ffprobe = findFfprobe();
  assert.ok(ffmpeg && ffprobe, 'ffmpeg + ffprobe required for this smoke');

  const realSource = findRealSource();
  if (!realSource) {
    console.log(JSON.stringify({ ok: true, skipped: 'no real captured take found (STEM_COLOR_SMOKE_SRC and STEM_OUT_ROOT unset, ~/Movies/stem-recorder empty)' }, null, 2));
    return;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'color-range-smoke-'));
  const rawSrc = path.join(workDir, 'raw.mp4');
  await runFfmpeg(ffmpeg, ['-hide_banner', '-y', '-i', realSource, '-t', '2', '-c', 'copy', rawSrc]);

  const ingestOut = path.join(workDir, 'screen.mp4');
  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y', '-i', rawSrc,
    '-vf', 'scale=in_range=full:out_range=tv',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    '-an',
    ingestOut,
  ]);
  const ingestTags = probeColorTags(ffprobe, ingestOut);
  const ingestRange = probeLumaRange(ffprobe, ingestOut);
  assert.deepStrictEqual(ingestTags, {
    color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709',
  }, `ingest output color tags wrong, got ${JSON.stringify(ingestTags)}`);
  assert.ok(ingestRange.min >= 4 && ingestRange.max <= 250, `ingest data must be remapped into limited range, got ${JSON.stringify(ingestRange)}`);

  const exportOut = path.join(workDir, 'export.mp4');
  await applyClips(ingestOut, [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: 2 }], exportOut, path.join(workDir, '.work'));
  const exportTags = probeColorTags(ffprobe, exportOut);
  const exportRange = probeLumaRange(ffprobe, exportOut);
  assert.deepStrictEqual(exportTags, {
    color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709',
  }, `export output color tags wrong, got ${JSON.stringify(exportTags)}`);
  assert.ok(exportRange.min >= 8 && exportRange.max <= 248, `export data must not re-expand past the ingest limited range, got ${JSON.stringify(exportRange)}`);

  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(JSON.stringify({
    ok: true, realSource, ingestTags, ingestRange, exportTags, exportRange,
  }, null, 2));
}

if (process.argv.includes('--self-test')) {
  selfTest();
  console.log('smoke-color-range: source resolution self-test OK');
} else {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
