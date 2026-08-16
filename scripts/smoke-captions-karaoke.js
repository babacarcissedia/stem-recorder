#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for lib/captions.js: N-word cue chunking (Task C1) and ASS
 * karaoke rendering with libass \k tags (Task C2). Pure string/array
 * assertions — no ffmpeg binary, no node_modules.
 */

const assert = require('assert');
const {
  chunkWords,
  centiseconds,
  escapeAssText,
  toAssTimestamp,
  buildKaraokeCueText,
  buildKaraokeAss,
} = require('../lib/captions');

// —— chunkWords: default N=3, exact multiples split cleanly ——
{
  const words = [
    { word: 'the', start: 0, end: 0.2 },
    { word: 'quick', start: 0.2, end: 0.5 },
    { word: 'brown', start: 0.5, end: 0.9 },
    { word: 'fox', start: 0.9, end: 1.1 },
    { word: 'jumps', start: 1.1, end: 1.4 },
    { word: 'high', start: 1.4, end: 1.6 },
  ];
  const cues = chunkWords(words);
  assert.strictEqual(cues.length, 2);
  assert.deepStrictEqual(cues[0].words.map((w) => w.word), ['the', 'quick', 'brown']);
  assert.deepStrictEqual(cues[1].words.map((w) => w.word), ['fox', 'jumps', 'high']);
  assert.strictEqual(cues[0].start, 0);
  assert.strictEqual(cues[0].end, 0.9);
  assert.strictEqual(cues[1].start, 0.9);
  assert.strictEqual(cues[1].end, 1.6);
}

// —— chunkWords: trailing partial group is emitted, not dropped ——
{
  const words = [
    { word: 'one', start: 0, end: 0.1 },
    { word: 'two', start: 0.1, end: 0.2 },
    { word: 'three', start: 0.2, end: 0.3 },
    { word: 'four', start: 0.3, end: 0.4 },
  ];
  const cues = chunkWords(words, { wordsPerCue: 3 });
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[1].words.length, 1);
  assert.strictEqual(cues[1].words[0].word, 'four');
}

// —— chunkWords: a large gap forces an early split even mid-group ——
{
  const words = [
    { word: 'hello', start: 0, end: 0.3 },
    { word: 'world', start: 0.4, end: 0.6 },
    { word: 'later', start: 3.0, end: 3.3 }, // 2.4s gap >> default 1.2s threshold
  ];
  const cues = chunkWords(words);
  assert.strictEqual(cues.length, 2);
  assert.deepStrictEqual(cues[0].words.map((w) => w.word), ['hello', 'world']);
  assert.deepStrictEqual(cues[1].words.map((w) => w.word), ['later']);
}

// —— chunkWords: configurable wordsPerCue and maxGapSec ——
{
  const words = [
    { word: 'a', start: 0, end: 0.1 },
    { word: 'b', start: 0.1, end: 0.2 },
    { word: 'c', start: 1.5, end: 1.6 }, // 1.3s gap — under a relaxed 2s threshold
  ];
  const cues = chunkWords(words, { wordsPerCue: 5, maxGapSec: 2 });
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].words.length, 3);
}

// —— chunkWords: zero and inverted duration words clamp flat, don't throw ——
{
  const words = [
    { word: 'zero', start: 1, end: 1 },
    { word: 'inverted', start: 2, end: 1.5 },
  ];
  const cues = chunkWords(words);
  assert.strictEqual(cues[0].words[0].end, 1);
  assert.strictEqual(cues[0].words[1].start, 2);
  assert.strictEqual(cues[0].words[1].end, 2);
}

// —— chunkWords: empty input → [] ——
assert.deepStrictEqual(chunkWords([]), []);
assert.deepStrictEqual(chunkWords(null), []);

// —— chunkWords: blank word tokens are skipped ——
{
  const words = [
    { word: 'real', start: 0, end: 0.1 },
    { word: '   ', start: 0.1, end: 0.2 },
    { word: '', start: 0.2, end: 0.3 },
  ];
  const cues = chunkWords(words);
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].words.length, 1);
}

// —— centiseconds: the classic \k unit bug — seconds must become CENTIseconds ——
assert.strictEqual(centiseconds(1), 100);
assert.strictEqual(centiseconds(0.5), 50);
assert.strictEqual(centiseconds(0.005), 1); // rounds, never floors to 0 on a real duration
assert.strictEqual(centiseconds(0), 0);
assert.strictEqual(centiseconds(-1), 0); // never negative

// —— escapeAssText: braces are override blocks, backslash + newline handled ——
assert.strictEqual(escapeAssText('plain text'), 'plain text');
assert.strictEqual(escapeAssText('a {fake} tag'), 'a \\{fake\\} tag');
assert.strictEqual(escapeAssText('back\\slash'), 'back\\\\slash');
assert.strictEqual(escapeAssText('line1\nline2'), 'line1\\Nline2');
assert.strictEqual(escapeAssText('line1\r\nline2'), 'line1\\Nline2');
// commas need no escaping — Text is the last (greedy) Dialogue field
assert.strictEqual(escapeAssText('wait, really?'), 'wait, really?');
assert.strictEqual(escapeAssText(null), '');

// —— toAssTimestamp: H:MM:SS.cc, single-digit hour, NOT SRT format ——
assert.strictEqual(toAssTimestamp(0), '0:00:00.00');
assert.strictEqual(toAssTimestamp(1.5), '0:00:01.50');
assert.strictEqual(toAssTimestamp(65), '0:01:05.00');
assert.strictEqual(toAssTimestamp(3661.23), '1:01:01.23');
// rounding carry across the second boundary doesn't leak into cs=100
assert.strictEqual(toAssTimestamp(0.999), '0:00:01.00');
assert.strictEqual(toAssTimestamp(59.999), '0:01:00.00');

// —— buildKaraokeCueText: per-word \k in CENTIseconds, gap becomes a silent hold ——
{
  const text = buildKaraokeCueText([
    { word: 'hi', start: 0, end: 0.3 },
    { word: 'there', start: 0.5, end: 0.9 }, // 0.2s gap after "hi"
  ]);
  assert.strictEqual(text, '{\\k30}hi {\\k20}{\\k40}there');
}

// —— buildKaraokeCueText: no gap tag emitted when words are back-to-back ——
{
  const text = buildKaraokeCueText([
    { word: 'go', start: 0, end: 0.2 },
    { word: 'now', start: 0.2, end: 0.5 },
  ]);
  assert.strictEqual(text, '{\\k20}go {\\k30}now');
}

// —— buildKaraokeAss: valid document shape, correct Format lines, karaoke tags present ——
{
  const words = [
    { word: 'the', start: 0, end: 0.2 },
    { word: 'quick', start: 0.2, end: 0.5 },
    { word: 'brown', start: 0.5, end: 0.9 },
    { word: 'fox', start: 0.9, end: 1.1 },
  ];
  const doc = buildKaraokeAss(words, { wordsPerCue: 3 });
  assert.ok(doc.includes('[Script Info]'));
  assert.ok(doc.includes('[V4+ Styles]'));
  assert.ok(doc.includes('[Events]'));
  assert.ok(/^Format: Name, Fontname, Fontsize/m.test(doc));
  assert.ok(/^Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text$/m.test(doc));
  assert.ok(doc.includes('PlayResX: 1080'));
  assert.ok(doc.includes('PlayResY: 1920'));
  const dialogueLines = doc.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.strictEqual(dialogueLines.length, 2);
  assert.ok(dialogueLines[0].includes('{\\k'));
  assert.ok(dialogueLines[0].startsWith('Dialogue: 0,0:00:00.00,0:00:00.90,Karaoke,,0,0,0,,'));
  assert.ok(dialogueLines[1].startsWith('Dialogue: 0,0:00:00.90,0:00:01.10,Karaoke,,0,0,0,,'));
}

// —— buildKaraokeAss: style controls are parameters, not constants ——
{
  const words = [{ word: 'hi', start: 0, end: 0.5 }];
  const small = buildKaraokeAss(words, { fontSize: 32, verticalPosition: 0.667, resolutionY: 1920 });
  const big = buildKaraokeAss(words, { fontSize: 96, verticalPosition: 0.75, resolutionY: 1920 });
  assert.ok(small.includes(',32,'));
  assert.ok(big.includes(',96,'));
  // two-thirds vs three-quarters down the frame produce different MarginV
  const marginOf = (doc) => doc.match(/Style: Karaoke,[^\n]*?,(\d+),1$/m)[1];
  assert.notStrictEqual(marginOf(small), marginOf(big));
  assert.strictEqual(marginOf(big), String(Math.round((1 - 0.75) * 1920)));
}

// —— buildKaraokeAss: empty word list still produces a valid (event-less) document ——
{
  const doc = buildKaraokeAss([]);
  assert.ok(doc.includes('[Events]'));
  assert.strictEqual(doc.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 0);
}

console.log(JSON.stringify({ ok: true, cases: 24 }, null, 2));
