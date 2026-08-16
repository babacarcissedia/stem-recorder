#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  findClipAtTime,
  splitAt,
  cutClip,
  cutRange,
  copySlice,
  pasteAfter,
  trimClip,
  totalOutputDuration,
  normalizeCrop,
  normalizeCam,
  normalizePipLayout,
  cropsEqual,
  setCrop,
  normalizeCaptions,
  normalizeVertical,
} = require('../lib/domain/clip-ops.ts');
const { createUndoStack } = require('../lib/domain/undo-stack.ts');

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

{
  // Cam settings: only { mirror: true } and 90-step rotate persist;
  // anything else is "no settings".
  assert.deepStrictEqual(normalizeCam({ mirror: true }), { mirror: true });
  assert.strictEqual(normalizeCam({ mirror: false }), null);
  assert.strictEqual(normalizeCam({ mirror: 'yes' }), null);
  assert.strictEqual(normalizeCam({}), null);
  assert.strictEqual(normalizeCam(null), null);
  assert.strictEqual(normalizeCam('mirror'), null);
  assert.deepStrictEqual(normalizeCam({ rotate: 90 }), { rotate: 90 });
  assert.deepStrictEqual(normalizeCam({ rotate: 180 }), { rotate: 180 });
  assert.deepStrictEqual(normalizeCam({ mirror: true, rotate: 270 }), { mirror: true, rotate: 270 });
  assert.strictEqual(normalizeCam({ rotate: 0 }), null);
  assert.strictEqual(normalizeCam({ rotate: 45 }), null);
  assert.strictEqual(normalizeCam({ rotate: '90' }), null);
  assert.strictEqual(normalizeCam({ rotate: 360 }), null);
  assert.deepStrictEqual(normalizeCam({ mirror: false, rotate: 90 }), { rotate: 90 });
  // Edit-T2a: pip defaults ON — only the opt-out (pip: false) is stored.
  assert.strictEqual(normalizeCam({ pip: true }), null);
  assert.deepStrictEqual(normalizeCam({ pip: false }), { pip: false });
  assert.strictEqual(normalizeCam({ pip: 'off' }), null);
  assert.deepStrictEqual(normalizeCam({ mirror: true, rotate: 90, pip: false }), { mirror: true, rotate: 90, pip: false });
  assert.deepStrictEqual(normalizeCam({ mirror: true, pip: true }), { mirror: true });

  // Edit-T2b: pipLayout { x, y, w } normalized to the output frame.
  assert.deepStrictEqual(normalizePipLayout({ x: 0.6, y: 0.65, w: 0.3 }), { x: 0.6, y: 0.65, w: 0.3 });
  assert.strictEqual(normalizePipLayout(null), null);
  assert.strictEqual(normalizePipLayout({ x: 0.5, y: 0.5 }), null); // w required
  assert.strictEqual(normalizePipLayout({ x: 'a', y: 0, w: 0.3 }), null);
  // w clamps to [0.1, 0.8]; x clamps so the box stays inside the frame width.
  assert.deepStrictEqual(normalizePipLayout({ x: 0.9, y: 0, w: 0.05 }), { x: 0.9, y: 0, w: 0.1 });
  assert.deepStrictEqual(normalizePipLayout({ x: 0.9, y: 2, w: 0.9 }), { x: 0.2, y: 0.95, w: 0.8 });
  assert.deepStrictEqual(normalizePipLayout({ x: -1, y: -1, w: 0.25 }), { x: 0, y: 0, w: 0.25 });
  // rounding to 4dp
  assert.deepStrictEqual(normalizePipLayout({ x: 0.123456, y: 0.5, w: 0.25 }), { x: 0.1235, y: 0.5, w: 0.25 });
  // normalizeCam carries it (fresh object) and drops invalid layouts.
  assert.deepStrictEqual(normalizeCam({ pipLayout: { x: 0.6, y: 0.65, w: 0.3 } }), { pipLayout: { x: 0.6, y: 0.65, w: 0.3 } });
  const sharedLayout = { x: 0.6, y: 0.65, w: 0.3 };
  assert.notStrictEqual(normalizeCam({ pipLayout: sharedLayout }).pipLayout, sharedLayout);
  assert.strictEqual(normalizeCam({ pipLayout: { x: 1 } }), null);
  assert.deepStrictEqual(
    normalizeCam({ mirror: true, pip: false, pipLayout: { x: 0.1, y: 0.1, w: 0.2 } }),
    { mirror: true, pip: false, pipLayout: { x: 0.1, y: 0.1, w: 0.2 } }
  );
}

{
  // I.6 copySlice: deep clones (crop included), bounds checked.
  const rect = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const clips = setCrop(splitAt(base, 0, 4, 10), rect);
  const copied = copySlice(clips, 0, 2);
  assert.strictEqual(copied.length, 2);
  assert.notStrictEqual(copied[0], clips[0]);
  assert.notStrictEqual(copied[0].crop, clips[0].crop);
  assert.deepStrictEqual(copied.map((c) => [c.in, c.out]), [[0, 4], [4, 10]]);
  copied[0].in = 99;
  copied[0].crop.x = 0.9;
  assert.strictEqual(clips[0].in, 0);
  assert.strictEqual(clips[0].crop.x, 0.25);
  for (const bad of [() => copySlice(clips, -1, 1), () => copySlice(clips, 2, 1), () => copySlice(clips, 0, 3), () => copySlice(clips, 0, 0)]) {
    let threw = false;
    try { bad(); } catch (_) { threw = true; }
    assert.strictEqual(threw, true);
  }
}

{
  // I.6 pasteAfter: fresh ids, flags preserved, ripple duration, cut→paste round trip.
  const rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const clips = setCrop(splitAt(base, 0, 4, 10), rect);
  const board = copySlice(clips, 1, 1);
  const res = pasteAfter(clips, board, 0);
  assert.strictEqual(res.clips.length, 3);
  assert.strictEqual(res.firstPastedIndex, 1);
  assert.strictEqual(res.pastedCount, 1);
  assert.deepStrictEqual(res.clips.map((c) => [c.in, c.out]), [[0, 4], [4, 10], [4, 10]]);
  const pasted = res.clips[1];
  assert.notStrictEqual(pasted.id, clips[1].id);
  assert.strictEqual(cropsEqual(pasted.crop, rect), true);
  assert.strictEqual(pasted.source, 'screen.mp4');
  assert.strictEqual(totalOutputDuration(res.clips, 10), 16);
  // Paste at the very start (afterIndex -1) and past the end clamp.
  assert.deepStrictEqual(pasteAfter(clips, board, -1).clips.map((c) => [c.in, c.out]), [[4, 10], [0, 4], [4, 10]]);
  assert.deepStrictEqual(pasteAfter(clips, board, 99).clips.map((c) => [c.in, c.out]), [[0, 4], [4, 10], [4, 10]]);
  // Cut → paste round trip restores the same in/out sequence.
  const afterCut = cutClip(clips, 0);
  const back = pasteAfter(afterCut, copySlice(clips, 0, 1), -1);
  assert.deepStrictEqual(back.clips.map((c) => [c.in, c.out]), clips.map((c) => [c.in, c.out]));
  // Empty clipboard throws.
  let threw = false;
  try { pasteAfter(clips, [], 0); } catch (_) { threw = true; }
  assert.strictEqual(threw, true);
}

{
  assert.strictEqual(normalizeCaptions(null), null);
  assert.strictEqual(normalizeCaptions(undefined), null);
  assert.strictEqual(normalizeCaptions('burn'), null);
  assert.strictEqual(normalizeCaptions({}), null);
  assert.strictEqual(normalizeCaptions({ burn: false }), null);
  assert.strictEqual(normalizeCaptions({ burn: 'yes' }), null);
  assert.deepStrictEqual(normalizeCaptions({ burn: true }), { burn: true });
  assert.deepStrictEqual(normalizeCaptions({ burn: true, style: 'segment' }), { burn: true });
  assert.deepStrictEqual(normalizeCaptions({ burn: true, style: 'karaoke' }), { burn: true, style: 'karaoke' });
  assert.deepStrictEqual(normalizeCaptions({ burn: true, style: 'bogus' }), { burn: true });
  assert.deepStrictEqual(normalizeCaptions({ burn: true, style: 'Karaoke' }), { burn: true });
  assert.deepStrictEqual(normalizeCaptions({ burn: true, style: 42 }), { burn: true });
  assert.strictEqual(normalizeCaptions({ burn: false, style: 'karaoke' }), null);

  assert.strictEqual(normalizeVertical(true), true);
  assert.strictEqual(normalizeVertical(false), null);
  assert.strictEqual(normalizeVertical(null), null);
  assert.strictEqual(normalizeVertical(undefined), null);
  assert.strictEqual(normalizeVertical('true'), null);
  assert.strictEqual(normalizeVertical(1), null);
  assert.strictEqual(normalizeVertical({}), null);
}

console.log(JSON.stringify({ ok: true, cases: 15 }));
