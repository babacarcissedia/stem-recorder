#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  findClipAtTime,
  splitAt,
  cutClip,
  cutRange,
  trimClip,
  normalizeCrop,
  cropsEqual,
  setCrop,
} = require('../lib/clip-ops');
const { createUndoStack } = require('../lib/undo-stack');

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

{
  const clips = [{ id: 'a', source: 'screen.mp4', in: 0, out: 10 }];
  const a = splitAt(clips, 0, 2, 10);
  const b = splitAt(a, 1, 5, 10);
  assert.strictEqual(b.length, 3);
  const cut = cutClip(b, 1);
  assert.deepStrictEqual(
    cut.map((c) => [c.in, c.out]),
    [[0, 2], [5, 10]],
  );
}

{
  // Undo/redo mirrors the studio flow: push the pre-op state, mutate, undo, redo.
  const stack = createUndoStack();
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.canRedo(), false);
  assert.strictEqual(stack.undo(base), null);

  let clips = base;
  stack.push(clips);
  clips = splitAt(clips, 0, 4, 10);
  stack.push(clips);
  clips = cutClip(clips, 0);
  assert.deepStrictEqual(clips.map((c) => [c.in, c.out]), [[4, 10]]);

  clips = stack.undo(clips);
  assert.deepStrictEqual(clips.map((c) => [c.in, c.out]), [[0, 4], [4, 10]]);
  assert.strictEqual(stack.canRedo(), true);

  clips = stack.undo(clips);
  assert.deepStrictEqual(clips.map((c) => [c.in, c.out]), [[0, 10]]);
  assert.strictEqual(stack.canUndo(), false);

  clips = stack.redo(clips);
  clips = stack.redo(clips);
  assert.deepStrictEqual(clips.map((c) => [c.in, c.out]), [[4, 10]]);
  assert.strictEqual(stack.canRedo(), false);
  assert.strictEqual(stack.redo(clips), null);
}

{
  // A fresh push clears the redo stack.
  const stack = createUndoStack();
  stack.push('s0');
  const prev = stack.undo('s1');
  assert.strictEqual(prev, 's0');
  assert.strictEqual(stack.canRedo(), true);
  stack.push('s0b');
  assert.strictEqual(stack.canRedo(), false);
}

{
  // Cap: oldest snapshots fall off, undo never exceeds the limit.
  const stack = createUndoStack(3);
  for (let i = 0; i < 10; i += 1) stack.push(i);
  const popped = [];
  let cur = 10;
  while (stack.canUndo()) {
    cur = stack.undo(cur);
    popped.push(cur);
  }
  assert.deepStrictEqual(popped, [9, 8, 7]);
}

{
  // Crop: clamp to frame, reject junk, treat full frame as "no crop".
  assert.deepStrictEqual(normalizeCrop({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 }), { x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
  assert.deepStrictEqual(normalizeCrop({ x: -1, y: 0, w: 5, h: 0.5 }), { x: 0, y: 0, w: 1, h: 0.5 });
  assert.strictEqual(normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }), null);
  assert.strictEqual(normalizeCrop(null), null);
  assert.strictEqual(normalizeCrop({ x: 'a', y: 0, w: 1, h: 1 }), null);
  assert.strictEqual(cropsEqual(null, null), true);
  assert.strictEqual(cropsEqual({ x: 0, y: 0, w: 0.5, h: 0.5 }, null), false);
  assert.strictEqual(cropsEqual({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.5 }), true);
}

{
  // setCrop stamps every clip; null clears; crop survives split and cutRange.
  const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const clips = setCrop(splitAt(base, 0, 4, 10), rect);
  assert.deepStrictEqual(clips.map((c) => c.crop), [rect, rect]);

  const afterSplit = splitAt(clips, 1, 7, 10);
  assert.deepStrictEqual(afterSplit.map((c) => c.crop), [rect, rect, rect]);

  const afterCut = cutRange(afterSplit, 2, 5, 10);
  assert.strictEqual(afterCut.every((c) => cropsEqual(c.crop, rect)), true);

  const cleared = setCrop(afterCut, null);
  assert.strictEqual(cleared.every((c) => c.crop === undefined), true);
}

console.log(JSON.stringify({ ok: true, cases: 11 }));
