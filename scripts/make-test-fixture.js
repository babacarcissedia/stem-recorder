#!/usr/bin/env node
'use strict';

/**
 * Generate a deterministic test fixture for smoke-apply.js.
 *
 * Creates an 8-second, 1280x720, H.264, yuv420p video at
 * $STEM_OUT_ROOT/take-demo/screen.mp4. The fixture is VIDEO-ONLY (no audio),
 * which is critical: recorded stems in this app carry no audio track, and a
 * fixture with an audio track produces a duration mismatch that looks exactly
 * like a code failure. This guard prevents fixture-based false positives.
 *
 * Usage: node scripts/make-test-fixture.js
 * Env: STEM_OUT_ROOT (default: /tmp/stem-test-takes)
 */

const path = require('path');
const fs = require('fs');
const { findFfmpeg, runFfmpeg, probeDuration } = require('../lib/node/ffmpeg-util.js');

async function main() {
  const stemOutRoot = process.env.STEM_OUT_ROOT || '/tmp/stem-test-takes';
  const takeDir = path.join(stemOutRoot, 'take-demo');
  const outputPath = path.join(takeDir, 'screen.mp4');

  console.log(`STEM_OUT_ROOT: ${stemOutRoot}`);
  console.log(`Target: ${outputPath}`);

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    console.error('Error: ffmpeg not found on PATH.');
    console.error('Please install ffmpeg or set FFMPEG_PATH.');
    process.exit(1);
  }

  fs.mkdirSync(takeDir, { recursive: true });

  // Generate fixture: 8 seconds, 1280x720, H.264, yuv420p.
  // -an disables audio — do NOT remove this flag. The fixture must be
  // video-only because recorded stems carry no audio track; if the fixture
  // includes an audio track, duration mismatch will read as a code failure.
  const args = [
    '-f', 'lavfi',
    '-i', 'testsrc=size=1280x720:rate=30:duration=8',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-an',
    outputPath,
    '-y',
  ];

  try {
    await runFfmpeg(ffmpeg, args);
  } catch (error) {
    console.error(`Error: ffmpeg failed to generate fixture.`);
    console.error(error.message);
    process.exit(1);
  }

  if (!fs.existsSync(outputPath)) {
    console.error(`Error: fixture file was not created at ${outputPath}`);
    process.exit(1);
  }

  const duration = probeDuration(outputPath);
  if (duration === null) {
    console.error(`Error: could not probe duration of ${outputPath}`);
    process.exit(1);
  }

  console.log(`✓ Fixture created: ${outputPath}`);
  console.log(`✓ Duration: ${duration.toFixed(2)}s`);
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
