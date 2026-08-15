#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  findClipAtTime,
  splitAt,
  cutClip,
  cutRange,
  trimClip,
} = require('../lib/clip-ops');

const base = [
  { id: 'a', source: 'screen.mp4', in: 0, out: 10 },
];

{
  const idx = findClipAtTime(base, 3, 10);
  assert.strictEqual(idx, 0);
  const split = splitAt(base, 0, 3, 10);
  assert.strictEqual(split.length, 2);
  assert.deepStrictEqual(
    split.map((c) => [c.in, c.out]),
    [[0, 3], [3, 10]],
  );
}

{
  const two = splitAt(base, 0, 4, 10);
  const cut = cutClip(two, 0);
  assert.strictEqual(cut.length, 1);
  assert.deepStrictEqual([cut[0].in, cut[0].out], [4, 10]);
}

{
  const clips = [{ id: 'a', source: 'screen.mp4', in: 0, out: 10 }];
  const cut = cutRange(clips, 2, 5, 10);
  assert.strictEqual(cut.length, 2);
  assert.deepStrictEqual(
    cut.map((c) => [c.in, c.out]),
    [[0, 2], [5, 10]],
  );
}

{
  const clips = [
    { id: 'a', source: 'screen.mp4', in: 0, out: 3 },
    { id: 'b', source: 'screen.mp4', in: 3, out: 8 },
  ];
  const cut = cutRange(clips, 2, 5, 10);
  assert.deepStrictEqual(
    cut.map((c) => [c.in, c.out]),
    [[0, 2], [5, 8]],
  );
}

{
  const clips = [{ id: 'a', source: 'screen.mp4', in: 0, out: 10 }];
  const trimmed = trimClip(clips, 0, 1, 8, 10);
  assert.deepStrictEqual([trimmed[0].in, trimmed[0].out], [1, 8]);
  let threw = false;
  try { trimClip(clips, 0, 5, 5.05, 10); } catch (_) { threw = true; }
  assert.strictEqual(threw, true);
}

console.log(JSON.stringify({ ok: true, cases: 5 }));
