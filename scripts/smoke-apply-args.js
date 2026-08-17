#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildClipRenderPlan, resolveTakeLocalDialoguePath, clipArgs, freezeArgs, clipCacheKey,
  cropFilter, freezeStillChain, subtitlesFilter, pipFilterGraph,
} = require('../lib/node/ffmpeg-util.js');

const FREEZE_SEEK_BACKOFF = 0.05;
const ENCODE_ARGS = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-movflags', '+faststart',
];
const SRC_PATH = '/fixtures/screen.mp4';
const DIALOGUE_PATH = '/fixtures/audio.mp3';
const CAM_PATH = '/fixtures/cam.mp4';

function basePlan(overrides = {}) {
  return {
    srcPath: SRC_PATH,
    crop: null,
    encodeArgs: ENCODE_ARGS,
    cam: null,
    subtitles: null,
    rate: null,
    inputArgs: ['-i', SRC_PATH],
    filterArgs: [],
    pip: null,
    withSilence: false,
    camDur: null,
    srcStamp: 'stamp-src-1',
    subtitlesStamp: null,
    camStamp: null,
    ...overrides,
  };
}

function testProductionPlainPlanMapsTakeLocalDialogueAudio() {
  const plan = buildClipRenderPlan({
    srcPath: SRC_PATH,
    dialoguePath: '/fixtures/dialogue.m4a',
    cam: null,
    crop: null,
    subtitles: null,
    rate: null,
    verticalPreset: null,
    pip: null,
  });
  assert.deepStrictEqual(plan.inputArgs, ['-i', SRC_PATH, '-i', '/fixtures/dialogue.m4a']);
  assert.deepStrictEqual(plan.filterArgs, ['-map', '0:v:0', '-map', '1:a:0']);
  assert.strictEqual(plan.filterArgs.includes('0:a?'), false);
}

function testProductionPipPlanMapsTakeLocalDialogueAudio() {
  const cam = { path: CAM_PATH, mirror: true, rotate: 90, layout: null };
  const pip = { layout: null, pipWidth: 480, margin: 24 };
  const plan = buildClipRenderPlan({
    srcPath: SRC_PATH,
    dialoguePath: '/fixtures/dialogue.m4a',
    cam,
    crop: null,
    subtitles: null,
    rate: null,
    verticalPreset: null,
    pip,
  });
  assert.deepStrictEqual(plan.inputArgs, ['-i', SRC_PATH, '-i', '/fixtures/dialogue.m4a', '-i', CAM_PATH]);
  assert.ok(plan.filterArgs[1].startsWith('[0:v]null[base];[2:v]'));
  assert.deepStrictEqual(plan.filterArgs.slice(-4), ['-map', '[v]', '-map', '1:a:0']);
  assert.strictEqual(plan.filterArgs.includes('0:a?'), false);
}

function testTakeLocalDialogueSourcePathsRejectEscapesAndMissingFiles() {
  const takeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-dialogue-route-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-dialogue-outside-'));
  const dialoguePath = path.join(takeDir, 'sources', 'dialogue.m4a');
  const outsidePath = path.join(outsideDir, 'outside.m4a');
  fs.mkdirSync(path.dirname(dialoguePath), { recursive: true });
  fs.writeFileSync(dialoguePath, 'fixture');
  fs.writeFileSync(outsidePath, 'fixture');
  fs.symlinkSync(outsidePath, path.join(takeDir, 'sources', 'escaped.m4a'));
  try {
    assert.strictEqual(resolveTakeLocalDialoguePath(takeDir, 'sources/dialogue.m4a'), fs.realpathSync(dialoguePath));
    assert.throws(
      () => resolveTakeLocalDialoguePath(takeDir, '../outside.m4a'),
      /outside take directory/,
    );
    assert.throws(
      () => resolveTakeLocalDialoguePath(takeDir, 'sources/escaped.m4a'),
      /outside take directory/,
    );
    assert.throws(
      () => resolveTakeLocalDialoguePath(takeDir, 'sources/missing.m4a'),
      /selected dialogue source is missing/,
    );
  } finally {
    fs.rmSync(takeDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
}

function testPlainTrimArgs() {
  const args = clipArgs(basePlan(), { in: 2, out: 6 });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-i', SRC_PATH, '-ss', '2', '-to', '6',
    ...ENCODE_ARGS,
  ]);
}

function testTrimWithoutOutArgs() {
  const args = clipArgs(basePlan(), { in: 3, out: null });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-i', SRC_PATH, '-ss', '3',
    ...ENCODE_ARGS,
  ]);
}

function testTrimWithCropArgs() {
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const plan = basePlan({ crop, filterArgs: ['-vf', cropFilter(crop)] });
  const args = clipArgs(plan, { in: 1, out: 5 });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-i', SRC_PATH, '-ss', '1', '-to', '5',
    '-vf', cropFilter(crop),
    ...ENCODE_ARGS,
  ]);
}

function testFreezeSegmentArgs() {
  const args = clipArgs(basePlan(), { in: 6, out: 7.5, freeze: true });
  const seekTo = String(6 - FREEZE_SEEK_BACKOFF);
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-ss', seekTo, '-i', SRC_PATH,
    '-vf', freezeStillChain(1.5),
    '-map', '0:v:0',
    '-an',
    '-t', '1.5',
    ...ENCODE_ARGS,
  ]);
}

function testFreezeWithCropArgs() {
  const crop = { x: 0, y: 0, w: 1, h: 0.5 };
  const args = clipArgs(basePlan({ crop }), { in: 6, out: 7.5, freeze: true });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-ss', String(6 - FREEZE_SEEK_BACKOFF), '-i', SRC_PATH,
    '-vf', `${cropFilter(crop)},${freezeStillChain(1.5)}`,
    '-map', '0:v:0',
    '-an',
    '-t', '1.5',
    ...ENCODE_ARGS,
  ]);
}

function testFreezeVsRateShrinksHoldDuration() {
  const plan = basePlan({ rate: 2 });
  const args = freezeArgs(plan, { in: 6, out: 7.5, freeze: true });
  const tIndex = args.indexOf('-t');
  assert.strictEqual(args[tIndex + 1], '0.75');
  assert.ok(args.some((a) => typeof a === 'string' && a.includes('stop_duration=0.75')));
}

function testFreezeVsRateStretchesHoldDuration() {
  const plan = basePlan({ rate: 0.5 });
  const args = freezeArgs(plan, { in: 6, out: 7.5, freeze: true });
  assert.ok(args.includes('3'));
}

function testFreezeRejectsNonPositiveDuration() {
  let threw = false;
  try {
    freezeArgs(basePlan(), { in: 6, out: 6, freeze: true });
  } catch (e) {
    threw = true;
    assert.match(e.message, /positive duration/);
  }
  assert.strictEqual(threw, true);
}

function testSubtitlesPresentAddsFilter() {
  const subPath = '/fixtures/captions.vtt';
  const plan = basePlan({ subtitles: subPath, filterArgs: ['-vf', subtitlesFilter(subPath)] });
  const args = clipArgs(plan, { in: 0, out: 4 });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-i', SRC_PATH, '-ss', '0', '-to', '4',
    '-vf', subtitlesFilter(subPath),
    ...ENCODE_ARGS,
  ]);
}

function testSubtitlesAbsentOmitsFilter() {
  const args = clipArgs(basePlan(), { in: 0, out: 4 });
  assert.ok(!args.includes('-vf'));
}

function testSubtitlesSkippedOnFreezeClips() {
  const subPath = '/fixtures/captions.vtt';
  const plan = basePlan({ subtitles: subPath, filterArgs: ['-vf', subtitlesFilter(subPath)] });
  const args = clipArgs(plan, { in: 6, out: 7.5, freeze: true });
  assert.ok(!args.some((a) => typeof a === 'string' && a.includes('subtitles=')));
}

function camPipPlan(overrides = {}) {
  const cam = { path: CAM_PATH, mirror: true, rotate: 90, layout: null };
  const pip = { layout: null, pipWidth: 480, margin: 24 };
  const renderPlan = buildClipRenderPlan({
    srcPath: SRC_PATH,
    dialoguePath: DIALOGUE_PATH,
    cam,
    crop: null,
    subtitles: null,
    rate: null,
    verticalPreset: null,
    pip,
  });
  return basePlan({
    cam,
    pip,
    inputArgs: renderPlan.inputArgs,
    filterArgs: renderPlan.filterArgs,
    ...overrides,
  });
}

function testCamPipPresentUsesFilterComplex() {
  const plan = camPipPlan();
  const args = clipArgs(plan, { in: 0, out: 4 });
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-i', SRC_PATH, '-i', DIALOGUE_PATH, '-i', CAM_PATH, '-ss', '0', '-to', '4',
    '-filter_complex', plan.filterArgs[1],
    '-map', '[v]', '-map', '1:a:0',
    ...ENCODE_ARGS,
  ]);
}

function testCamPipAbsentUsesSingleInput() {
  const args = clipArgs(basePlan(), { in: 0, out: 4 });
  assert.deepStrictEqual(args.slice(0, 4), ['-hide_banner', '-y', '-i', SRC_PATH]);
  assert.ok(!args.includes('-filter_complex'));
}

function testFreezeWithCamAndSilenceArgs() {
  const cam = { path: CAM_PATH, mirror: true, rotate: 90 };
  const pip = { layout: null, pipWidth: 480, margin: 24 };
  const plan = basePlan({
    cam, pip, withSilence: true, camDur: 5,
  });
  const args = freezeArgs(plan, { in: 6, out: 7.5, freeze: true });
  const seekTo = 6 - FREEZE_SEEK_BACKOFF;
  const camSeek = Math.min(seekTo, Math.max(0, plan.camDur - 0.2));
  assert.deepStrictEqual(args, [
    '-hide_banner', '-y', '-ss', String(seekTo), '-i', SRC_PATH,
    '-ss', String(camSeek), '-i', CAM_PATH,
    '-f', 'lavfi', '-t', '1.5', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-filter_complex', pipFilterGraph({ crop: null, cam, ...pip, freezeDur: 1.5 }),
    '-map', '[v]',
    '-map', '2:a',
    '-t', '1.5',
    ...ENCODE_ARGS,
  ]);
}

function testCacheKeySameInputsSameKey() {
  const plan = basePlan();
  const clip = { in: 2, out: 6 };
  assert.strictEqual(clipCacheKey(plan, { ...clip }), clipCacheKey(plan, { ...clip }));
}

function testCacheKeyDimensions() {
  const plan = basePlan();
  const clip = { in: 2, out: 6 };
  const baseline = clipCacheKey(plan, clip);

  const distinctKeys = new Set([baseline]);

  distinctKeys.add(clipCacheKey(plan, { ...clip, in: 2.5 }));
  distinctKeys.add(clipCacheKey(plan, { ...clip, out: 6.5 }));
  distinctKeys.add(clipCacheKey(basePlan({ crop: { x: 0, y: 0, w: 1, h: 1 } }), clip));
  distinctKeys.add(clipCacheKey(plan, { ...clip, freeze: true }));
  distinctKeys.add(clipCacheKey(
    basePlan({ subtitles: '/fixtures/captions.vtt', subtitlesStamp: 'stamp-vtt-1' }),
    clip,
  ));
  distinctKeys.add(clipCacheKey(
    basePlan({ cam: { path: CAM_PATH, mirror: false, rotate: 0, layout: null }, camStamp: 'stamp-cam-1' }),
    clip,
  ));
  distinctKeys.add(clipCacheKey(basePlan({ rate: 2 }), clip));
  distinctKeys.add(clipCacheKey(basePlan({ srcStamp: 'stamp-src-2' }), clip));

  assert.strictEqual(distinctKeys.size, 9);
}

function testCacheKeyIgnoresSubtitlesOnFreezeClips() {
  const clip = { in: 6, out: 7.5, freeze: true };
  const withSubs = clipCacheKey(
    basePlan({ subtitles: '/fixtures/captions.vtt', subtitlesStamp: 'stamp-vtt-1' }),
    clip,
  );
  const withoutSubs = clipCacheKey(basePlan(), clip);
  assert.strictEqual(withSubs, withoutSubs);
}

const tests = [
  testProductionPlainPlanMapsTakeLocalDialogueAudio,
  testProductionPipPlanMapsTakeLocalDialogueAudio,
  testTakeLocalDialogueSourcePathsRejectEscapesAndMissingFiles,
  testPlainTrimArgs,
  testTrimWithoutOutArgs,
  testTrimWithCropArgs,
  testFreezeSegmentArgs,
  testFreezeWithCropArgs,
  testFreezeVsRateShrinksHoldDuration,
  testFreezeVsRateStretchesHoldDuration,
  testFreezeRejectsNonPositiveDuration,
  testSubtitlesPresentAddsFilter,
  testSubtitlesAbsentOmitsFilter,
  testSubtitlesSkippedOnFreezeClips,
  testCamPipPresentUsesFilterComplex,
  testCamPipAbsentUsesSingleInput,
  testFreezeWithCamAndSilenceArgs,
  testCacheKeySameInputsSameKey,
  testCacheKeyDimensions,
  testCacheKeyIgnoresSubtitlesOnFreezeClips,
];

for (const test of tests) test();

console.log(JSON.stringify({ ok: true, cases: tests.length }, null, 2));
