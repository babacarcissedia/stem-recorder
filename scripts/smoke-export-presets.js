#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for lib/export-presets.js: vertical 9:16 crop/scale/PiP
 * geometry (Task C3). Pure arithmetic assertions — no ffmpeg binary, no
 * node_modules.
 */

const assert = require('assert');
const {
  ensureEven,
  computeCropRect,
  computePipRect,
  buildVerticalPreset,
} = require('../lib/export-presets');

// —— ensureEven: H.264 requires even dims ——
assert.strictEqual(ensureEven(1080), 1080);
assert.strictEqual(ensureEven(1081), 1080);
assert.strictEqual(ensureEven(0), 0);
assert.strictEqual(ensureEven(-5), 0);
assert.strictEqual(ensureEven(3.6), 4);
assert.strictEqual(ensureEven(3.4), 2);

// —— computeCropRect: wide source (16:9-ish) cropped to 9:16 keeps full height, crops sides ——
{
  const rect = computeCropRect(3024, 1964, 1080, 1920);
  assert.strictEqual(rect.h, 1964 % 2 === 0 ? 1964 : 1963);
  assert.strictEqual(rect.w % 2, 0);
  assert.strictEqual(rect.h % 2, 0);
  // width should match the target aspect against full height
  const expectedWidth = ensureEven((1964 * (1080 / 1920)));
  assert.strictEqual(rect.w, expectedWidth);
  // centered
  assert.strictEqual(rect.x, ensureEven((3024 - rect.w) / 2));
  assert.strictEqual(rect.y, ensureEven((1964 - rect.h) / 2));
  assert.ok(rect.x + rect.w <= 3024);
  assert.ok(rect.y + rect.h <= 1964);
}

// —— computeCropRect: a source already taller than target crops top/bottom, keeps full width ——
{
  const rect = computeCropRect(1080, 2400, 1080, 1920);
  assert.strictEqual(rect.w, 1080);
  assert.ok(rect.h < 2400);
  assert.strictEqual(rect.h % 2, 0);
  assert.ok(rect.y + rect.h <= 2400);
}

// —— computeCropRect: exact aspect match crops nothing ——
{
  const rect = computeCropRect(1080, 1920, 1080, 1920);
  assert.strictEqual(rect.w, 1080);
  assert.strictEqual(rect.h, 1920);
  assert.strictEqual(rect.x, 0);
  assert.strictEqual(rect.y, 0);
}

// —— computeCropRect: rejects non-positive dimensions ——
assert.throws(() => computeCropRect(0, 100, 1080, 1920), /positive/);
assert.throws(() => computeCropRect(100, -1, 1080, 1920), /positive/);

// —— computePipRect: default bottom-right placement, even dims, aspect-correct ——
{
  const rect = computePipRect(1080, 1920);
  assert.strictEqual(rect.position, 'bottom-right');
  assert.strictEqual(rect.w % 2, 0);
  assert.strictEqual(rect.h % 2, 0);
  assert.ok(rect.x + rect.w <= 1080);
  assert.ok(rect.y + rect.h <= 1920);
  assert.ok(rect.x > 0 && rect.y > 0); // margin keeps it off both edges
}

// —— computePipRect: cam aspect ratio drives height, not a fixed default ——
{
  const square = computePipRect(1080, 1920, { cam: { width: 100, height: 100 }, widthFraction: 0.3 });
  assert.strictEqual(square.w, square.h);
  const wide = computePipRect(1080, 1920, { cam: { width: 16, height: 9 }, widthFraction: 0.3 });
  assert.ok(wide.h < wide.w);
}

// —— computePipRect: every named position places the box inside the frame ——
for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'bottom-center']) {
  const rect = computePipRect(1080, 1920, { position, widthFraction: 0.3, marginFraction: 0.05 });
  assert.strictEqual(rect.position, position);
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.w <= 1080);
  assert.ok(rect.y + rect.h <= 1920);
}

// —— computePipRect: unknown position falls back to the default, doesn't throw ——
assert.strictEqual(computePipRect(1080, 1920, { position: 'middle-earth' }).position, 'bottom-right');

// —— computePipRect: rejects non-positive target dimensions ——
assert.throws(() => computePipRect(0, 1920), /positive/);

// —— buildVerticalPreset: end-to-end 3024x1964 screen → 1080x1920, all even ——
{
  const preset = buildVerticalPreset({ source: { width: 3024, height: 1964 } });
  assert.strictEqual(preset.scale.width, 1080);
  assert.strictEqual(preset.scale.height, 1920);
  assert.strictEqual(preset.crop.w % 2, 0);
  assert.strictEqual(preset.crop.h % 2, 0);
  assert.strictEqual(preset.pip.w % 2, 0);
  assert.strictEqual(preset.pip.h % 2, 0);
  assert.ok(preset.pip.x + preset.pip.w <= preset.scale.width);
  assert.ok(preset.pip.y + preset.pip.h <= preset.scale.height);
}

// —— buildVerticalPreset: custom target + cam + pip options thread through ——
{
  const preset = buildVerticalPreset({
    source: { width: 1920, height: 1080 },
    target: { width: 720, height: 1281 }, // odd height on purpose — must settle even
    cam: { width: 1280, height: 720 },
    pip: { position: 'top-left', widthFraction: 0.4, marginFraction: 0.02 },
  });
  assert.strictEqual(preset.scale.height, 1280);
  assert.strictEqual(preset.pip.position, 'top-left');
  assert.ok(preset.pip.x < preset.scale.width / 2);
  assert.ok(preset.pip.y < preset.scale.height / 2);
}

// —— buildVerticalPreset: requires a source ——
assert.throws(() => buildVerticalPreset({}), /source/);
assert.throws(() => buildVerticalPreset({ source: { width: 0, height: 100 } }), /source/);

console.log(JSON.stringify({ ok: true, cases: 17 }, null, 2));
