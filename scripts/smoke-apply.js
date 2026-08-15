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

const { applyClips, probeDuration } = require('../lib/ffmpeg-util');
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
  fs.rmSync(work, { recursive: true, force: true });
  const dur = probeDuration(out);
  console.log(JSON.stringify({ takeId, out, expected: 4, duration: dur, ok: dur != null && Math.abs(dur - 4) < 0.35 }, null, 2));
  if (dur == null || Math.abs(dur - 4) >= 0.35) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
