#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for the Edit-T2e export speed + music bed (pure string /
 * math assertions — no ffmpeg binary needed). Locks the contracts:
 * atempo decomposition stays inside the filter's 0.5–2 range, the speed
 * stage renders AFTER the caption burn (cues read source PTS), the music
 * mix ducks the bed without touching the dialogue level, and manifest
 * normalization clamps/strips both keys.
 */

const assert = require('assert');
const {
  speedVideoFilter, atempoChain, musicMixGraph, pipFilterGraph,
} = require('../lib/node/ffmpeg-util.js');
const { normalizeExportRate, normalizeMusic } = require('../lib/domain/clip-ops.ts');

// —— atempoChain: each step within [0.5, 2], product = rate ——
assert.deepStrictEqual(atempoChain(1), []);
assert.deepStrictEqual(atempoChain(1.5), ['atempo=1.5']);
assert.deepStrictEqual(atempoChain(2), ['atempo=2']);
assert.deepStrictEqual(atempoChain(2.5), ['atempo=2', 'atempo=1.25']);
assert.deepStrictEqual(atempoChain(4), ['atempo=2', 'atempo=2']);
assert.deepStrictEqual(atempoChain(0.5), ['atempo=0.5']);
assert.deepStrictEqual(atempoChain(0.25), ['atempo=0.5', 'atempo=0.5']);
assert.deepStrictEqual(atempoChain(0.4), ['atempo=0.5', 'atempo=0.8']);
for (const rate of [0.25, 0.4, 0.75, 1.25, 1.75, 2, 3, 4]) {
  const product = atempoChain(rate)
    .map((s) => Number(s.split('=')[1]))
    .reduce((acc, f) => acc * f, 1);
  assert.ok(Math.abs(product - rate) < 1e-6, `atempo product for ${rate}`);
}

// —— speedVideoFilter ——
assert.strictEqual(speedVideoFilter(1.25), 'setpts=PTS/1.25');

// —— pipFilterGraph: rate stage appended last, after the caption burn ——
const sped = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, rate: 1.5 });
assert.strictEqual(
  sped,
  '[0:v]null[base];[1:v]scale=w=480:h=-2[pip];[base][pip]overlay=x=W-w-24:y=H-h-24[ov];[ov]setpts=PTS/1.5[v]'
);
const burnAndSpeed = pipFilterGraph({
  crop: null, cam: {}, pipWidth: 480, margin: 24, subtitlesPath: '/tmp/c.vtt', rate: 2,
});
assert.ok(
  burnAndSpeed.indexOf('subtitles=') < burnAndSpeed.indexOf('setpts=PTS/2'),
  'captions must burn before the speed change (cues read source PTS)'
);

// —— rate 1 / absent keeps the T2b graph byte-for-byte ——
const plain = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24 });
assert.strictEqual(pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, rate: 1 }), plain);

// —— musicMixGraph: duck the bed, dialogue level untouched ——
assert.strictEqual(
  musicMixGraph({ gainDb: -18, baseHasAudio: true }),
  '[1:a]volume=-18dB[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[a]'
);
assert.strictEqual(
  musicMixGraph({ gainDb: -12, baseHasAudio: false }),
  '[1:a]volume=-12dB[a]'
);

// —— normalizeExportRate: clamp 0.25–4, 1× stored as absent ——
assert.strictEqual(normalizeExportRate(1), null);
assert.strictEqual(normalizeExportRate('1.5'), 1.5);
assert.strictEqual(normalizeExportRate(9), 4);
assert.strictEqual(normalizeExportRate(0.1), 0.25);
assert.strictEqual(normalizeExportRate('nope'), null);
assert.strictEqual(normalizeExportRate(null), null);

// —— normalizeMusic: path required, gain defaulted and clamped ≤ 0 dB ——
assert.strictEqual(normalizeMusic(null), null);
assert.strictEqual(normalizeMusic({ path: '' }), null);
assert.deepStrictEqual(normalizeMusic({ path: '/m/bed.mp3' }), { path: '/m/bed.mp3', gainDb: -18 });
assert.deepStrictEqual(normalizeMusic({ path: '/m/bed.mp3', gainDb: 5 }), { path: '/m/bed.mp3', gainDb: 0 });
assert.deepStrictEqual(normalizeMusic({ path: '/m/bed.mp3', gainDb: -100 }), { path: '/m/bed.mp3', gainDb: -60 });

// —— manifest round-trip keeps both keys (and strips the defaults) ——
const { normalizeManifest } = require('../lib/node/edit-manifest.js');
const doc = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
  exportRate: 1.25,
  music: { path: '/m/bed.mp3', gainDb: -18 },
}, 'take-x', 8);
assert.strictEqual(doc.exportRate, 1.25);
assert.deepStrictEqual(doc.music, { path: '/m/bed.mp3', gainDb: -18 });
const bare = normalizeManifest({ clips: [{ id: 'clip-1', in: 0, out: 4 }], exportRate: 1 }, 'take-x', 8);
assert.ok(!('exportRate' in bare) && !('music' in bare));

const karaokeOn = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
  captions: { burn: true, style: 'karaoke' },
  vertical: true,
}, 'take-x', 8);
assert.deepStrictEqual(karaokeOn.captions, { burn: true, style: 'karaoke' });
assert.strictEqual(karaokeOn.vertical, true);

const segmentDefault = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
  captions: { burn: true },
}, 'take-x', 8);
assert.deepStrictEqual(segmentDefault.captions, { burn: true });
assert.ok(!('vertical' in segmentDefault));

const badStyleAndVertical = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
  captions: { burn: true, style: 'unknown-style' },
  vertical: 'yes',
}, 'take-x', 8);
assert.deepStrictEqual(badStyleAndVertical.captions, { burn: true });
assert.ok(!('vertical' in badStyleAndVertical));

const styleWithoutBurn = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
  captions: { style: 'karaoke' },
}, 'take-x', 8);
assert.ok(!('captions' in styleWithoutBurn));

const defaultsUnchanged = normalizeManifest({
  clips: [{ id: 'clip-1', in: 0, out: 4 }],
}, 'take-x', 8);
assert.ok(!('captions' in defaultsUnchanged) && !('vertical' in defaultsUnchanged));

console.log(JSON.stringify({ ok: true, cases: 33 }, null, 2));
