#!/usr/bin/env node
'use strict';

/**
 * Merge gate: architecture boundaries + every headless smoke, fail-fast,
 * real exit codes. `npm run preflight` must exit 0 before any PR merges.
 *
 * smoke:apply needs real takes on disk, so it only runs when STEM_OUT_ROOT
 * is set; otherwise it reports OK-skipped instead of failing a clean checkout.
 */

const { spawnSync } = require('child_process');

const steps = [
  { name: 'check-architecture', cmd: ['node', 'scripts/check-architecture.js'] },
  { name: 'check-hex-literals', cmd: ['node', 'scripts/check-hex-literals.js'] },
  { name: 'smoke:model', cmd: ['npm', 'run', 'smoke:model'] },
  { name: 'smoke:manifest', cmd: ['npm', 'run', 'smoke:manifest'] },
  { name: 'smoke:clips', cmd: ['npm', 'run', 'smoke:clips'] },
  { name: 'smoke:apply-args', cmd: ['node', 'scripts/smoke-apply-args.js'] },
  { name: 'smoke:pip', cmd: ['npm', 'run', 'smoke:pip'] },
  { name: 'smoke:freeze', cmd: ['npm', 'run', 'smoke:freeze'] },
  { name: 'smoke:gaps', cmd: ['npm', 'run', 'smoke:gaps'] },
  { name: 'smoke:thumbs', cmd: ['npm', 'run', 'smoke:thumbs'] },
  { name: 'smoke:transcribe', cmd: ['npm', 'run', 'smoke:transcribe'] },
  { name: 'smoke:captions', cmd: ['npm', 'run', 'smoke:captions'] },
  { name: 'smoke:export', cmd: ['npm', 'run', 'smoke:export'] },
  { name: 'smoke:captions-karaoke', cmd: ['npm', 'run', 'smoke:captions-karaoke'] },
  { name: 'smoke:export-presets', cmd: ['npm', 'run', 'smoke:export-presets'] },
  { name: 'smoke:export-bundle', cmd: ['npm', 'run', 'smoke:export-bundle'] },
  { name: 'smoke:media-url', cmd: ['npm', 'run', 'smoke:media-url'] },
  { name: 'smoke:shortcuts', cmd: ['npm', 'run', 'smoke:shortcuts'] },
  { name: 'smoke:theme', cmd: ['npm', 'run', 'smoke:theme'] },
  { name: 'smoke:caption-integration', cmd: ['node', 'scripts/smoke-caption-integration.js'] },
  {
    name: 'smoke:apply',
    cmd: ['npm', 'run', 'smoke:apply'],
    skip: () => (process.env.STEM_OUT_ROOT ? null : 'STEM_OUT_ROOT not set (needs takes on disk)'),
  },
];

let failed = false;
for (const step of steps) {
  const skipReason = step.skip && step.skip();
  if (skipReason) {
    console.log(`\n== ${step.name}: OK (skipped: ${skipReason})`);
    continue;
  }
  console.log(`\n== ${step.name}: ${step.cmd.join(' ')}`);
  const result = spawnSync(step.cmd[0], step.cmd.slice(1), { stdio: 'inherit' });
  const code = result.status === null ? 1 : result.status;
  console.log(`== ${step.name}: exit ${code}`);
  if (code !== 0) {
    failed = true;
    break; // fail-fast
  }
}

console.log(failed ? '\npreflight: FAIL' : '\npreflight: OK');
process.exit(failed ? 1 : 0);
