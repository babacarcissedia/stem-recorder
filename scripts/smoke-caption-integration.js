#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for the wt/integration wiring of lib/captions.js and
 * lib/export-presets.js into lib/ffmpeg-util.js:
 *   - resolveCaptionsPath: word-level ASS vs segment-level VTT selection
 *   - verticalCropScaleFilter + pipFilterGraph(verticalPreset): 9:16 export
 *     geometry and its composition with the cam PiP overlay
 * Pure assertions on filter-graph strings, generated ASS content, and fs
 * side effects — no ffmpeg binary, no node_modules, runs everywhere.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveCaptionsPath, verticalCropScaleFilter, pipFilterGraph, cropFilter,
} = require('../lib/ffmpeg-util');
const { buildVerticalPreset } = require('../lib/export-presets');

let cases = 0;
function tmpEditDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stem-caption-integration-'));
}

// —— resolveCaptionsPath: word-level asr.json produces an ASS under edit/.cache/ ——
{
  const editDir = tmpEditDir();
  const asr = {
    segments: [{ start: 0, end: 1.1, text: 'the quick brown fox' }],
    words: [
      { word: 'the', start: 0, end: 0.2 },
      { word: 'quick', start: 0.2, end: 0.5 },
      { word: 'brown', start: 0.5, end: 0.9 },
      { word: 'fox', start: 0.9, end: 1.1 },
    ],
  };
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify(asr), 'utf8');
  fs.writeFileSync(path.join(editDir, 'captions.vtt'), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.100\nthe quick brown fox\n', 'utf8');

  const result = resolveCaptionsPath(editDir, { wordsPerCue: 3 });
  assert.strictEqual(result, path.join(editDir, '.cache', 'captions-karaoke.ass'));
  assert.ok(fs.existsSync(result), 'ASS file must actually be written');
  const doc = fs.readFileSync(result, 'utf8');
  assert.ok(doc.includes('[Script Info]'));
  assert.ok(doc.includes('{\\k'), 'karaoke tags must be present');
  assert.ok(doc.split('\n').filter((l) => l.startsWith('Dialogue:')).length > 0);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— resolveCaptionsPath: style options thread through to the generated ASS ——
{
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify({
    words: [{ word: 'hi', start: 0, end: 0.5 }],
  }), 'utf8');
  const result = resolveCaptionsPath(editDir, { fontSize: 88, verticalPosition: 0.667, resolutionY: 1920 });
  const doc = fs.readFileSync(result, 'utf8');
  assert.ok(doc.includes(',88,'), 'fontSize option must reach the Style line');
  const marginV = doc.match(/Style: Karaoke,[^\n]*?,(\d+),1$/m)[1];
  assert.strictEqual(marginV, String(Math.round((1 - 0.667) * 1920)));
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— resolveCaptionsPath: no words[] on asr.json falls back to captions.vtt ——
{
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify({ segments: [] }), 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  assert.ok(!fs.existsSync(path.join(editDir, '.cache', 'captions-karaoke.ass')));
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— resolveCaptionsPath: malformed asr.json falls back to VTT instead of throwing ——
{
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), 'not json', 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— resolveCaptionsPath: neither asr.json nor captions.vtt exist → null ——
{
  const editDir = tmpEditDir();
  assert.strictEqual(resolveCaptionsPath(editDir), null);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— resolveCaptionsPath: empty words[] (present but no timings) also falls back to VTT ——
{
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify({ words: [] }), 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

// —— verticalCropScaleFilter: matches buildVerticalPreset's absolute-pixel geometry ——
{
  const preset = buildVerticalPreset({ source: { width: 3024, height: 1964 } });
  const filter = verticalCropScaleFilter(preset);
  assert.strictEqual(
    filter,
    `crop=w=${preset.crop.w}:h=${preset.crop.h}:x=${preset.crop.x}:y=${preset.crop.y},scale=w=${preset.scale.width}:h=${preset.scale.height}`,
  );
  assert.ok(filter.includes('crop=w=') && filter.includes(',scale=w='), 'crop must precede scale');
  cases += 1;
}

// —— pipFilterGraph + verticalPreset: vertical crop/scale lands in the base
// chain BEFORE the cam overlay, after any manual crop, and the overlay uses
// the preset's absolute pip.x/y instead of a normalized layout fraction ——
{
  const manualCrop = {
    x: 0.1, y: 0.1, w: 0.8, h: 0.8,
  };
  const preset = buildVerticalPreset({
    source: { width: 1600, height: 1600 }, // 0.8 of a 2000x2000 source, matching manualCrop above
    cam: { width: 1280, height: 720 },
  });
  const graph = pipFilterGraph({
    crop: manualCrop, cam: { mirror: false, rotate: 0 }, verticalPreset: preset,
  });

  const baseLine = graph.split(';')[0];
  assert.ok(baseLine.startsWith('[0:v]'), 'base chain reads the screen input');
  const manualCropStr = cropFilter(manualCrop);
  const verticalStr = verticalCropScaleFilter(preset);
  const expectedBaseFilters = `${manualCropStr},${verticalStr}`;
  assert.ok(
    baseLine.includes(expectedBaseFilters),
    `manual crop must precede the vertical crop/scale in the base chain: ${baseLine}`,
  );

  assert.ok(graph.includes(`x=${preset.pip.x}:y=${preset.pip.y}`), 'overlay must use the preset pip absolute position');
  assert.ok(graph.includes(`scale=w=${preset.pip.w}:h=-2`), 'cam scale width must come from the preset pip rect');
  cases += 1;
}

// —— pipFilterGraph + verticalPreset: composes with captions burn and speed,
// keeping caption burn AFTER the vertical scale (drawn on the final-resolution
// frame) and speed last, unchanged from the non-vertical ordering ——
{
  const preset = buildVerticalPreset({ source: { width: 1920, height: 1080 }, cam: { width: 640, height: 480 } });
  const graph = pipFilterGraph({
    crop: null,
    cam: { mirror: false, rotate: 0 },
    verticalPreset: preset,
    subtitlesPath: '/tmp/fake-captions.ass',
    rate: 1.5,
  });
  const overlayLine = graph.split(';').find((l) => l.includes('overlay='));
  assert.ok(overlayLine.endsWith('[ov]'), 'stages present after overlay use an intermediate label');
  const finalLine = graph.split(';').pop();
  const subtitlesIdx = finalLine.indexOf('subtitles=');
  const setptsIdx = finalLine.indexOf('setpts=');
  assert.ok(subtitlesIdx >= 0 && setptsIdx >= 0 && subtitlesIdx < setptsIdx, 'captions burn before speed, both after overlay');
  cases += 1;
}

// —— pipFilterGraph: no verticalPreset → unchanged base chain and normalized overlay (regression guard) ——
{
  const graph = pipFilterGraph({
    crop: { x: 0, y: 0, w: 1, h: 1 }, cam: { mirror: false, rotate: 0 }, pipWidth: 320, margin: 12,
  });
  assert.ok(!graph.includes('scale=w=1080:h=1920'), 'no vertical stage should appear when verticalPreset is absent');
  assert.ok(graph.includes('scale=w=320:h=-2'), 'pipWidth is honoured when there is no vertical preset');
  cases += 1;
}

console.log(JSON.stringify({ ok: true, cases }, null, 2));
