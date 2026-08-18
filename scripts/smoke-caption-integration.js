#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveCaptionsPath, verticalCropScaleFilter, pipFilterGraph, cropFilter,
} = require('../lib/node/ffmpeg-util.js');
const { buildVerticalPreset } = require('../lib/domain/export-presets.ts');

let cases = 0;

function tmpEditDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stem-caption-integration-'));
}

function testResolveCaptionsPathWordLevelAss() {
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

function testResolveCaptionsPathStyleOptions() {
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

function testResolveCaptionsPathNoWords() {
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify({ segments: [] }), 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  assert.ok(!fs.existsSync(path.join(editDir, '.cache', 'captions-karaoke.ass')));
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

function testResolveCaptionsPathMalformedAsr() {
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), 'not json', 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

function testResolveCaptionsPathNoArtifacts() {
  const editDir = tmpEditDir();
  assert.strictEqual(resolveCaptionsPath(editDir), null);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

function testResolveCaptionsPathEmptyWords() {
  const editDir = tmpEditDir();
  fs.writeFileSync(path.join(editDir, 'asr.json'), JSON.stringify({ words: [] }), 'utf8');
  const vttPath = path.join(editDir, 'captions.vtt');
  fs.writeFileSync(vttPath, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nfallback\n', 'utf8');
  assert.strictEqual(resolveCaptionsPath(editDir), vttPath);
  cases += 1;

  fs.rmSync(editDir, { recursive: true, force: true });
}

function testVerticalCropScaleFilterGeometry() {
  const preset = buildVerticalPreset({ source: { width: 3024, height: 1964 } });
  const filter = verticalCropScaleFilter(preset);
  assert.strictEqual(
    filter,
    `crop=w=${preset.crop.w}:h=${preset.crop.h}:x=${preset.crop.x}:y=${preset.crop.y},scale=w=${preset.scale.width}:h=${preset.scale.height}`,
  );
  assert.ok(filter.includes('crop=w=') && filter.includes(',scale=w='), 'crop must precede scale');
  cases += 1;
}

function testPipFilterGraphVerticalOrderingWithManualCrop() {
  const manualCrop = {
    x: 0.1, y: 0.1, w: 0.8, h: 0.8,
  };
  const absentPreset = buildVerticalPreset({
    source: { width: 1600, height: 1600 },
    cam: { width: 1280, height: 720 },
  });
  const preset = buildVerticalPreset({
    source: { width: 1600, height: 1600 },
    cam: { width: 1280, height: 720 },
    autozoom: { mode: 'center-cover' },
  });
  assert.deepStrictEqual(preset, absentPreset);
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

function testPipFilterGraphVerticalWithCaptionsAndSpeed() {
  const manualCrop = {
    x: 0.1, y: 0.1, w: 0.8, h: 0.8,
  };
  const preset = buildVerticalPreset({
    source: { width: 1920, height: 1080 },
    cam: { width: 640, height: 480 },
    autozoom: { mode: 'center-cover' },
  });
  const graph = pipFilterGraph({
    crop: manualCrop,
    cam: { mirror: false, rotate: 0 },
    verticalPreset: preset,
    subtitlesPath: '/tmp/fake-captions.ass',
    rate: 1.5,
  });
  const baseLine = graph.split(';')[0];
  const manualCropIdx = baseLine.indexOf(cropFilter(manualCrop));
  const verticalIdx = baseLine.indexOf(verticalCropScaleFilter(preset));
  const pipIdx = graph.indexOf('overlay=');
  const subtitlesIdx = graph.indexOf('subtitles=');
  const setptsIdx = graph.indexOf('setpts=');
  assert.ok(manualCropIdx >= 0 && verticalIdx > manualCropIdx, 'manual crop precedes vertical crop/scale');
  assert.ok(pipIdx > graph.indexOf(baseLine) && subtitlesIdx > pipIdx, 'PiP overlay precedes captions');
  assert.ok(setptsIdx > subtitlesIdx, 'speed follows captions');
  cases += 1;
}

function testPipFilterGraphWithoutVerticalPreset() {
  const graph = pipFilterGraph({
    crop: { x: 0, y: 0, w: 1, h: 1 }, cam: { mirror: false, rotate: 0 }, pipWidth: 320, margin: 12,
  });
  assert.ok(!graph.includes('scale=w=1080:h=1920'), 'no vertical stage should appear when verticalPreset is absent');
  assert.ok(graph.includes('scale=w=320:h=-2'), 'pipWidth is honoured when there is no vertical preset');
  cases += 1;
}

testResolveCaptionsPathWordLevelAss();
testResolveCaptionsPathStyleOptions();
testResolveCaptionsPathNoWords();
testResolveCaptionsPathMalformedAsr();
testResolveCaptionsPathNoArtifacts();
testResolveCaptionsPathEmptyWords();
testVerticalCropScaleFilterGeometry();
testPipFilterGraphVerticalOrderingWithManualCrop();
testPipFilterGraphVerticalWithCaptionsAndSpeed();
testPipFilterGraphWithoutVerticalPreset();

console.log(JSON.stringify({ ok: true, cases }, null, 2));
