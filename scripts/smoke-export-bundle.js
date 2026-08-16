#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { planExportBundle } = require('../lib/export-bundle');

function completeTakeIncludesFinalVideoAudioTranscriptCaptionsAndKaraokeAss() {
  const { items, missing } = planExportBundle({
    takeId: 'take-1',
    takeFiles: ['screen.mp4', 'cam.mp4', 'audio.mp3'],
    editFiles: ['final.mp4', 'transcript.txt', 'captions.vtt', 'asr.json', 'captions.ass'],
  });
  assert.deepStrictEqual(missing, []);
  const byKind = Object.fromEntries(items.map((i) => [i.kind, i]));
  assert.deepStrictEqual(byKind['video-final'], { source: 'edit/final.mp4', destName: 'video.mp4', kind: 'video-final' });
  assert.deepStrictEqual(byKind.audio, { source: 'audio.mp3', destName: 'audio.mp3', kind: 'audio' });
  assert.deepStrictEqual(byKind.transcript, { source: 'edit/transcript.txt', destName: 'transcript.txt', kind: 'transcript' });
  assert.deepStrictEqual(byKind['captions-vtt'], { source: 'edit/captions.vtt', destName: 'captions.vtt', kind: 'captions-vtt' });
  assert.deepStrictEqual(byKind['word-timings'], { source: 'edit/asr.json', destName: 'word-timings.json', kind: 'word-timings' });
  assert.deepStrictEqual(byKind['captions-ass'], { source: 'edit/captions.ass', destName: 'captions-karaoke.ass', kind: 'captions-ass' });
  assert.strictEqual(items.length, 6);
}

function takeWithoutAppliedFinalFallsBackToRawScreenSourceWithoutBeingReportedMissing() {
  const { items, missing } = planExportBundle({
    takeId: 'take-2',
    takeFiles: ['screen.mp4', 'audio.mp3'],
    editFiles: [],
  });
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(items.find((i) => i.kind === 'video-raw'), {
    source: 'screen.mp4', destName: 'video-unedited.mp4', kind: 'video-raw',
  });
  assert.ok(!items.some((i) => i.kind === 'video-final'));
}

function takeWithNoVideoStemAtAllIsReportedMissingVideo() {
  const { items, missing } = planExportBundle({
    takeId: 'take-3',
    takeFiles: ['audio.mp3'],
    editFiles: [],
  });
  assert.deepStrictEqual(missing, ['video']);
  assert.ok(!items.some((i) => i.kind.startsWith('video')));
}

function absentKaraokeAssIsNotApplicableNeverMissing() {
  const { items, missing } = planExportBundle({
    takeId: 'take-4',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4'],
  });
  assert.deepStrictEqual(missing, []);
  assert.ok(!items.some((i) => i.kind === 'captions-ass'));
}

function neverTranscribedTakeIsNotApplicableNeverMissing() {
  const { items, missing } = planExportBundle({
    takeId: 'take-5',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4'],
  });
  assert.deepStrictEqual(missing, []);
  assert.ok(!items.some((i) => ['transcript', 'captions-vtt', 'word-timings'].includes(i.kind)));
}

function partiallyTranscribedTakeReportsOnlyTheAbsentTranscribeOutputsAsMissing() {
  const { items, missing } = planExportBundle({
    takeId: 'take-6',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4', 'transcript.txt'],
  });
  assert.deepStrictEqual(missing.sort(), ['asr.json', 'captions.vtt']);
  assert.ok(items.some((i) => i.kind === 'transcript'));
}

function twoAssFilesAtOnceDisambiguateDestNamesInsteadOfColliding() {
  const { items } = planExportBundle({
    takeId: 'take-7',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4', 'captions.ass', 'karaoke.ass'],
  });
  const assItems = items.filter((i) => i.kind === 'captions-ass');
  assert.strictEqual(assItems.length, 2);
  const names = assItems.map((i) => i.destName).sort();
  assert.deepStrictEqual(names, ['captions-karaoke-2.ass', 'captions-karaoke.ass']);
  assert.strictEqual(new Set(names).size, 2);
}

function camOnlyTakeWithNoFinalFallsBackToCamAsVideoSource() {
  const { items, missing } = planExportBundle({
    takeId: 'take-8',
    takeFiles: ['cam.mp4'],
    editFiles: [],
  });
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(items.find((i) => i.kind === 'video-raw'), {
    source: 'cam.mp4', destName: 'video-unedited.mp4', kind: 'video-raw',
  });
}

function blankOrMissingTakeIdThrowsInsteadOfSilentlyPlanning() {
  assert.throws(() => planExportBundle({ takeFiles: [], editFiles: [] }), /takeId is required/);
  assert.throws(() => planExportBundle({ takeId: '', takeFiles: [], editFiles: [] }), /takeId is required/);
}

function emptyTakeReportsOnlyVideoAsMissing() {
  const { items, missing } = planExportBundle({ takeId: 'take-9', takeFiles: [], editFiles: [] });
  assert.deepStrictEqual(items, []);
  assert.deepStrictEqual(missing, ['video']);
}

const cases = [
  completeTakeIncludesFinalVideoAudioTranscriptCaptionsAndKaraokeAss,
  takeWithoutAppliedFinalFallsBackToRawScreenSourceWithoutBeingReportedMissing,
  takeWithNoVideoStemAtAllIsReportedMissingVideo,
  absentKaraokeAssIsNotApplicableNeverMissing,
  neverTranscribedTakeIsNotApplicableNeverMissing,
  partiallyTranscribedTakeReportsOnlyTheAbsentTranscribeOutputsAsMissing,
  twoAssFilesAtOnceDisambiguateDestNamesInsteadOfColliding,
  camOnlyTakeWithNoFinalFallsBackToCamAsVideoSource,
  blankOrMissingTakeIdThrowsInsteadOfSilentlyPlanning,
  emptyTakeReportsOnlyVideoAsMissing,
];
cases.forEach((testCase) => testCase());

console.log(JSON.stringify({ ok: true, cases: cases.length }, null, 2));
