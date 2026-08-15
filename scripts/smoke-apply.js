#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Edit-T1 apply (no Electron window).
 * Usage: STEM_OUT_ROOT=/tmp/stem-test-takes node scripts/smoke-apply.js take-demo
 */
const path = require('path');
const fs = require('fs');

// Minimal electron app stub so lib/paths can load without Electron when testing apply only
process.env.STEM_OUT_ROOT = process.env.STEM_OUT_ROOT || '/tmp/stem-test-takes';

const { applyClips, probeDuration, probeDimensions } = require('../lib/ffmpeg-util');
const { writeManifest, readManifest, FINAL_NAME } = require('../lib/edit-manifest');

async function main() {
  const takeId = process.argv[2] || 'take-demo';
  const { takeDir, duration, manifest } = readManifest(takeId);
  // Trim middle 2s of an 8s synthetic take: 2 → 6
  const doc = {
    ...manifest,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 2, out: 6 }],
  };
  writeManifest(takeId, doc);
  const src = path.join(takeDir, 'screen.mp4');
  const out = path.join(takeDir, FINAL_NAME);
  const work = path.join(takeDir, 'edit', '.work');
  fs.mkdirSync(work, { recursive: true });
  await applyClips(src, doc.clips, out, work);
  const dur = probeDuration(out);
  const trimOk = dur != null && Math.abs(dur - 4) < 0.35;

  // I.3: crop to the center quarter — manifest round-trip must keep the rect,
  // the export must come out at half the source dimensions (even-floored).
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  writeManifest(takeId, { ...doc, clips: doc.clips.map((c) => ({ ...c, crop })) });
  const reread = readManifest(takeId).manifest;
  const cropKept = JSON.stringify(reread.clips[0].crop) === JSON.stringify(crop);
  const cropOut = path.join(takeDir, 'edit', 'final-crop.mp4');
  await applyClips(src, reread.clips, cropOut, work);
  fs.rmSync(work, { recursive: true, force: true });
  const srcDim = probeDimensions(src);
  const outDim = probeDimensions(cropOut);
  const cropOk = Boolean(srcDim && outDim)
    && outDim.width === Math.floor((srcDim.width * crop.w) / 2) * 2
    && outDim.height === Math.floor((srcDim.height * crop.h) / 2) * 2;

  const ok = trimOk && cropKept && cropOk;
  console.log(JSON.stringify({
    takeId, out, expected: 4, duration: dur, trimOk,
    crop, cropKept, srcDim, outDim, cropOk, ok,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
