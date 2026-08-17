#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Edit-T2c freeze frames (pure — no ffmpeg binary
 * needed). Locks the model contract (a freeze segment is a clip with
 * freeze: true whose `in` is the held frame and out - in the hold length)
 * and the still filter chain, including its composition with crop + PiP.
 */

const assert = require('assert');
const {
  insertFreezeAfter,
  findClipAtTime,
  outputToSource,
  totalOutputDuration,
  splitAt,
  trimClip,
} = require('../lib/domain/clip-ops.ts');
const {
  freezeStillChain, pipFilterGraph, cropFilter,
} = require('../lib/node/ffmpeg-util.js');
const { normalizeManifest } = require('../lib/node/edit-manifest.js');

// —— insertFreezeAfter: freeze holds the clip's end for the given duration ——
{
  const clips = [{ id: 'a', source: 'screen.mp4', in: 0, out: 10 }];
  const res = insertFreezeAfter(clips, 0, 1.5, 30);
  assert.strictEqual(res.freezeIndex, 1);
  assert.strictEqual(res.clips.length, 2);
  const f = res.clips[1];
  assert.strictEqual(f.freeze, true);
  assert.strictEqual(f.in, 10);
  assert.strictEqual(f.out, 11.5);
  assert.strictEqual(f.source, 'screen.mp4');
  assert.notStrictEqual(f.id, 'a');
  assert.strictEqual(clips.length, 1); // input untouched
}

// —— open-ended clip uses the fallback duration as its end ——
{
  const res = insertFreezeAfter([{ id: 'a', in: 2, out: null }], 0, 2, 8);
  assert.deepStrictEqual([res.clips[1].in, res.clips[1].out], [8, 10]);
}

// —— crop is carried onto the freeze so the one-crop-per-take invariant holds ——
{
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const res = insertFreezeAfter([{ id: 'a', in: 0, out: 5, crop }], 0, 1, 5);
  assert.deepStrictEqual(res.clips[1].crop, crop);
  assert.notStrictEqual(res.clips[1].crop, crop); // deep copy
}

// —— guards: freeze-of-freeze, bad duration, bad index ——
assert.throws(() => insertFreezeAfter([{ in: 0, out: 5, freeze: true }], 0, 1, 5), /already a freeze/);
assert.throws(() => insertFreezeAfter([{ in: 0, out: 5 }], 0, 0.01, 5), /duration/);
assert.throws(() => insertFreezeAfter([{ in: 0, out: 5 }], 3, 1, 5), /no clip selected/);

// —— timeline math over [clip 0–10][freeze 1.5s][clip 10–20] ——
const timeline = [
  { id: 'a', in: 0, out: 10 },
  { id: 'f', in: 10, out: 11.5, freeze: true },
  { id: 'b', in: 10, out: 20 },
];
assert.strictEqual(totalOutputDuration(timeline, 30), 21.5);

// inside the freeze: sourceTime pins to the held frame
{
  const m = outputToSource(timeline, 10.7, 30);
  assert.strictEqual(m.index, 1);
  assert.strictEqual(m.sourceTime, 10);
}
// past the freeze: clip b maps normally
{
  const m = outputToSource(timeline, 12, 30);
  assert.strictEqual(m.index, 2);
  assert.strictEqual(m.sourceTime, 10.5);
}

// source-time lookup skips freeze segments (they are not source ranges)
assert.strictEqual(findClipAtTime(timeline, 10.2, 30), 2);

// split rejects freezes; trim adjusts the hold length
assert.throws(() => splitAt(timeline, 1, 10.7, 30), /freeze/);
{
  const trimmed = trimClip(timeline, 1, 10, 13, 30);
  assert.strictEqual(trimmed[1].out, 13);
  assert.strictEqual(trimmed[1].freeze, true);
}

// —— freezeStillChain: one frame, re-zeroed, tpad-cloned ——
assert.strictEqual(
  freezeStillChain(1.5),
  'trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1.5'
);

// —— pipFilterGraph + freezeDur: still stage composes after crop + overlay ——
const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
assert.strictEqual(
  pipFilterGraph({
    crop, cam: { mirror: true }, pipWidth: 320, margin: 12,
    layout: null, freezeDur: 2,
  }),
  `[0:v]${cropFilter(crop)}[base];[1:v]hflip,scale=w=320:h=-2[pip];`
  + '[base][pip]overlay=x=W-w-12:y=H-h-12[ov];'
  + `[ov]${freezeStillChain(2)}[v]`
);

// —— without freezeDur the T2a/T2b graph stays byte-for-byte identical ——
assert.strictEqual(
  pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24 }),
  '[0:v]null[base];[1:v]scale=w=480:h=-2[pip];[base][pip]overlay=x=W-w-24:y=H-h-24[v]'
);

// —— manifest round-trip keeps the freeze flag (and drops non-true values) ——
{
  const doc = normalizeManifest({
    clips: [
      { id: 'a', in: 0, out: 10 },
      { id: 'f', in: 10, out: 11.5, freeze: true },
      { id: 'b', in: 10, out: 20, freeze: 'yes' },
    ],
  }, 'take-x', 30);
  assert.strictEqual(doc.clips[1].freeze, true);
  assert.ok(!('freeze' in doc.clips[0]));
  assert.ok(!('freeze' in doc.clips[2]));
}

console.log(JSON.stringify({ ok: true, cases: 20 }, null, 2));
