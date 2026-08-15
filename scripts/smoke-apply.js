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

const { applyClips, probeDuration, probeDimensions, findFfmpeg, runFfmpeg } = require('../lib/ffmpeg-util');
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
  const srcDim = probeDimensions(src);
  const outDim = probeDimensions(cropOut);
  const cropOk = Boolean(srcDim && outDim)
    && outDim.width === Math.floor((srcDim.width * crop.w) / 2) * 2
    && outDim.height === Math.floor((srcDim.height * crop.h) / 2) * 2;

  // Edit-T2a: cam PiP overlay (mirror + rotate on the cam input) must keep
  // the base dimensions and the trimmed duration. Synthesize a cam stem when
  // the fixture take has none.
  const camSrc = path.join(takeDir, 'cam.mp4');
  if (!fs.existsSync(camSrc)) {
    await runFfmpeg(findFfmpeg(), [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=8',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      camSrc,
    ]);
  }
  const pipOut = path.join(takeDir, 'edit', 'final-pip.mp4');
  await applyClips(src, doc.clips, pipOut, work, {
    cam: { path: camSrc, mirror: true, rotate: 90 },
  });
  const pipDim = probeDimensions(pipOut);
  const pipDur = probeDuration(pipOut);
  const pipOk = Boolean(srcDim && pipDim)
    && pipDim.width === srcDim.width
    && pipDim.height === srcDim.height
    && pipDur != null && Math.abs(pipDur - 4) < 0.35;

  // Edit-T2c: a 1.5s freeze after the [2,6] trim must stretch the export to
  // ≈5.5s at unchanged dimensions — screen-only and composed with cam PiP.
  const freezeClips = [
    { id: 'clip-1', source: 'screen.mp4', in: 2, out: 6 },
    { id: 'clip-f', source: 'screen.mp4', in: 6, out: 7.5, freeze: true },
  ];
  const freezeOut = path.join(takeDir, 'edit', 'final-freeze.mp4');
  await applyClips(src, freezeClips, freezeOut, work);
  const frzDim = probeDimensions(freezeOut);
  const frzDur = probeDuration(freezeOut);
  const freezePipOut = path.join(takeDir, 'edit', 'final-freeze-pip.mp4');
  await applyClips(src, freezeClips, freezePipOut, work, {
    cam: { path: camSrc, mirror: true, rotate: 90 },
  });
  const frzPipDim = probeDimensions(freezePipOut);
  const frzPipDur = probeDuration(freezePipOut);
  fs.rmSync(work, { recursive: true, force: true });
  const freezeOk = Boolean(srcDim && frzDim && frzPipDim)
    && frzDim.width === srcDim.width && frzDim.height === srcDim.height
    && frzDur != null && Math.abs(frzDur - 5.5) < 0.4
    && frzPipDim.width === srcDim.width && frzPipDim.height === srcDim.height
    && frzPipDur != null && Math.abs(frzPipDur - 5.5) < 0.4;

  const ok = trimOk && cropKept && cropOk && pipOk && freezeOk;
  console.log(JSON.stringify({
    takeId, out, expected: 4, duration: dur, trimOk,
    crop, cropKept, srcDim, outDim, cropOk,
    pipDim, pipDur, pipOk,
    frzDur, frzDim, frzPipDur, frzPipDim, freezeOk, ok,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
