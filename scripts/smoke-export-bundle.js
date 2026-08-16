#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for lib/export-bundle.js (pure — no ffmpeg binary, no
 * node_modules). Locks the planner contract: which assets are included,
 * what they are named in the destination, and the missing-vs-not-applicable
 * rule for the ASR triplet, the video fallback, and karaoke .ass files.
 */

const assert = require('assert');
const { planExportBundle } = require('../lib/export-bundle');

// —— a complete take: final.mp4 + full ASR triplet + one karaoke .ass ——
{
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

// —— take missing final.mp4: Apply hasn't run — falls back to the raw
// source, no "missing" entry (that's a normal state, not a defect) ——
{
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

// —— take with no video stem at all: genuinely broken for a screen
// recorder — this IS flagged missing ——
{
  const { items, missing } = planExportBundle({
    takeId: 'take-3',
    takeFiles: ['audio.mp3'],
    editFiles: [],
  });
  assert.deepStrictEqual(missing, ['video']);
  assert.ok(!items.some((i) => i.kind.startsWith('video')));
}

// —— no karaoke .ass anywhere: not applicable, never reported as missing ——
{
  const { items, missing } = planExportBundle({
    takeId: 'take-4',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4'],
  });
  assert.deepStrictEqual(missing, []);
  assert.ok(!items.some((i) => i.kind === 'captions-ass'));
}

// —— transcribe never run (no ASR triplet member present): not applicable ——
{
  const { items, missing } = planExportBundle({
    takeId: 'take-5',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4'],
  });
  assert.deepStrictEqual(missing, []);
  assert.ok(!items.some((i) => ['transcript', 'captions-vtt', 'word-timings'].includes(i.kind)));
}

// —— transcribe partially run (interrupted / hand-edited): the absent
// members of the triplet ARE flagged missing, the present ones still ship ——
{
  const { items, missing } = planExportBundle({
    takeId: 'take-6',
    takeFiles: ['screen.mp4'],
    editFiles: ['final.mp4', 'transcript.txt'],
  });
  assert.deepStrictEqual(missing.sort(), ['asr.json', 'captions.vtt']);
  assert.ok(items.some((i) => i.kind === 'transcript'));
}

// —— destination-name collision: two .ass files present at once disambiguate
// instead of one clobbering the other ——
{
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

// —— cam.mp4-only take with no final.mp4: video falls back to cam.mp4 ——
{
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

// —— guards: missing/blank takeId throws rather than silently planning ——
assert.throws(() => planExportBundle({ takeFiles: [], editFiles: [] }), /takeId is required/);
assert.throws(() => planExportBundle({ takeId: '', takeFiles: [], editFiles: [] }), /takeId is required/);

// —— empty take: nothing present anywhere → only "video" is missing ——
{
  const { items, missing } = planExportBundle({ takeId: 'take-9', takeFiles: [], editFiles: [] });
  assert.deepStrictEqual(items, []);
  assert.deepStrictEqual(missing, ['video']);
}

console.log(JSON.stringify({ ok: true, cases: 10 }, null, 2));
