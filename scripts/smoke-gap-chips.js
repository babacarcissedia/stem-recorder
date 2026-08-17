#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  detectSilences,
  detectCueGaps,
  detectRetakes,
  textSimilarity,
  mergeIntervals,
  buildChips,
  chipOutputSpan,
} = require('../lib/domain/gap-chips.ts');

// detectSilences: quiet run of 1s at 4 peaks/sec between loud audio
{
  const peaks = [0.8, 0.7, 0.01, 0.02, 0.0, 0.03, 0.9, 0.8];
  const silences = detectSilences(peaks, 4, { minDur: 0.8 });
  assert.strictEqual(silences.length, 1);
  assert.deepStrictEqual(silences[0], { start: 0.5, end: 1.5 });
}

// detectSilences: trailing silence run is closed at the end of the peaks
{
  const peaks = [0.9, 0.9, 0.0, 0.0, 0.0, 0.0];
  const silences = detectSilences(peaks, 4, { minDur: 0.8 });
  assert.strictEqual(silences.length, 1);
  assert.deepStrictEqual(silences[0], { start: 0.5, end: 1.5 });
}

// detectSilences: runs shorter than minDur are ignored
{
  const peaks = [0.9, 0.0, 0.9, 0.9];
  assert.deepStrictEqual(detectSilences(peaks, 4, { minDur: 0.8 }), []);
}

// detectCueGaps: gap between cue 1 end and cue 2 start
{
  const cues = [
    { start: 0, end: 2, text: 'hello there' },
    { start: 4.5, end: 6, text: 'next line' },
    { start: 6.1, end: 7, text: 'no gap here' },
  ];
  const gaps = detectCueGaps(cues, { minDur: 0.8 });
  assert.strictEqual(gaps.length, 1);
  assert.deepStrictEqual(gaps[0], { start: 2, end: 4.5 });
}

// textSimilarity: identical > paraphrase > unrelated
{
  assert.strictEqual(textSimilarity('so today we ship it', 'so today we ship it'), 1);
  assert.ok(textSimilarity('so today we ship it', 'so today we ship this thing') > 0.5);
  assert.ok(textSimilarity('so today we ship it', 'completely different words entirely') < 0.2);
}

// detectRetakes: repeated line → chip covers the earlier take
{
  const cues = [
    { start: 0, end: 3, text: 'welcome to stem studio the local editor' },
    { start: 4, end: 7, text: 'welcome to stem studio the local editor' },
    { start: 8, end: 10, text: 'now something else entirely different' },
  ];
  const retakes = detectRetakes(cues);
  assert.strictEqual(retakes.length, 1);
  assert.strictEqual(retakes[0].start, 0);
  assert.strictEqual(retakes[0].end, 4);
}

// detectRetakes: short cues (< 3 tokens) never match
{
  const cues = [
    { start: 0, end: 1, text: 'okay' },
    { start: 2, end: 3, text: 'okay' },
  ];
  assert.deepStrictEqual(detectRetakes(cues), []);
}

// mergeIntervals: overlapping silence + cue-gap evidence collapses to one
{
  const merged = mergeIntervals([
    { start: 1, end: 2.5 },
    { start: 2.4, end: 4 },
    { start: 10, end: 11 },
  ]);
  assert.deepStrictEqual(merged, [
    { start: 1, end: 4 },
    { start: 10, end: 11 },
  ]);
}

// buildChips: silence + cue gap + retake all surface, sorted by start
{
  const peaks = [];
  for (let i = 0; i < 80; i += 1) peaks.push(i >= 20 && i < 28 ? 0.0 : 0.8); // silence 5s–7s @4pps
  const cues = [
    { start: 0, end: 4.8, text: 'first take of the intro line here' },
    { start: 8, end: 12, text: 'first take of the intro line here' },
    { start: 14, end: 16, text: 'closing words' },
  ];
  const chips = buildChips({ peaks, peaksPerSec: 4, cues });
  const kinds = chips.map((c) => c.kind);
  assert.ok(kinds.includes('gap'), 'expected a gap chip');
  assert.ok(kinds.includes('retake'), 'expected a retake chip');
  for (let i = 1; i < chips.length; i += 1) assert.ok(chips[i].start >= chips[i - 1].start);
  const retake = chips.find((c) => c.kind === 'retake');
  assert.deepStrictEqual([retake.start, retake.end], [0, 8]);
}

// chipOutputSpan: uncut timeline maps 1:1
{
  const clips = [{ id: 'a', in: 0, out: 10 }];
  assert.deepStrictEqual(chipOutputSpan(clips, 2, 4, 10), { start: 2, end: 4 });
}

// chipOutputSpan: chip after an earlier cut shifts left
{
  const clips = [
    { id: 'a', in: 0, out: 2 },
    { id: 'b', in: 5, out: 10 },
  ];
  assert.deepStrictEqual(chipOutputSpan(clips, 6, 8, 10), { start: 3, end: 5 });
}

// chipOutputSpan: chip fully inside a cut region disappears
{
  const clips = [
    { id: 'a', in: 0, out: 2 },
    { id: 'b', in: 5, out: 10 },
  ];
  assert.strictEqual(chipOutputSpan(clips, 3, 4.5, 10), null);
}

// chipOutputSpan: chip straddling a cut keeps only the kept parts
{
  const clips = [
    { id: 'a', in: 0, out: 2 },
    { id: 'b', in: 5, out: 10 },
  ];
  assert.deepStrictEqual(chipOutputSpan(clips, 1, 6, 10), { start: 1, end: 3 });
}

console.log('smoke-gap-chips OK');
