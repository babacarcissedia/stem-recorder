#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for the Edit-T2a cam-PiP filter graph (pure string
 * assertions — no ffmpeg binary needed). Locks the ARCHITECTURE contract:
 * mirror (hflip) before rotate (transpose) on the cam input, screen crop on
 * the base only, bottom-right overlay.
 */

const assert = require('assert');
const {
  camTransformFilters, pipOverlayPosition, pipFilterGraph, cropFilter,
} = require('../lib/node/ffmpeg-util.js');

// —— camTransformFilters: hflip first, then the clockwise transpose ——
assert.deepStrictEqual(camTransformFilters(null), []);
assert.deepStrictEqual(camTransformFilters({}), []);
assert.deepStrictEqual(camTransformFilters({ mirror: true }), ['hflip']);
assert.deepStrictEqual(camTransformFilters({ rotate: 90 }), ['transpose=1']);
assert.deepStrictEqual(camTransformFilters({ rotate: 180 }), ['hflip', 'vflip']);
assert.deepStrictEqual(camTransformFilters({ rotate: 270 }), ['transpose=2']);
assert.deepStrictEqual(camTransformFilters({ mirror: true, rotate: 90 }), ['hflip', 'transpose=1']);
assert.deepStrictEqual(
  camTransformFilters({ mirror: true, rotate: 180 }),
  ['hflip', 'hflip', 'vflip'] // literal chain: mirror in source space, then the 180 turn
);
assert.deepStrictEqual(camTransformFilters({ rotate: 0 }), []);

// —— pipFilterGraph: no crop → null base passthrough ——
const plain = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24 });
assert.strictEqual(
  plain,
  '[0:v]null[base];[1:v]scale=w=480:h=-2[pip];[base][pip]overlay=x=W-w-24:y=H-h-24[v]'
);

// —— pipFilterGraph: crop on the base, mirror+rotate before scale on the cam ——
const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
const full = pipFilterGraph({ crop, cam: { mirror: true, rotate: 90 }, pipWidth: 320, margin: 12 });
assert.strictEqual(
  full,
  `[0:v]${cropFilter(crop)}[base];[1:v]hflip,transpose=1,scale=w=320:h=-2[pip];[base][pip]overlay=x=W-w-12:y=H-h-12[v]`
);
// The cam chain must transform before scaling so the PiP box bounds the
// rotated frame, not the raw one.
assert.ok(full.indexOf('transpose=1') < full.indexOf('scale=w=320'));

// —— Edit-T2b pipOverlayPosition: no layout → the T2a bottom-right margin ——
assert.strictEqual(pipOverlayPosition(null, 24), 'x=W-w-24:y=H-h-24');

// —— layout → normalized position, clamped on-canvas as ffmpeg expressions ——
// (quoted so the commas inside min/max survive the filter-graph parser)
assert.strictEqual(
  pipOverlayPosition({ x: 0.05, y: 0.1, w: 0.3 }, 24),
  "x='min(max(W*0.05,0),W-w)':y='min(max(H*0.1,0),H-h)'"
);

// —— pipFilterGraph honors the layout end to end ——
const laidOut = pipFilterGraph({
  crop: null, cam: { mirror: true }, pipWidth: 384, margin: 24,
  layout: { x: 0.6, y: 0.65, w: 0.3 },
});
assert.strictEqual(
  laidOut,
  "[0:v]null[base];[1:v]hflip,scale=w=384:h=-2[pip];"
  + "[base][pip]overlay=x='min(max(W*0.6,0),W-w)':y='min(max(H*0.65,0),H-h)'[v]"
);

// —— no layout on pipFilterGraph keeps the T2a default graph byte-for-byte ——
assert.strictEqual(
  pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, layout: null }),
  plain
);

console.log(JSON.stringify({ ok: true, cases: 17 }, null, 2));
