'use strict';

import type { LegacyClip } from './clip-ops.ts';
import { totalOutputDuration } from './clip-ops.ts';

/**
 * Expected Apply output duration for a clip list (Edit-T1 timeline math),
 * scaled by export rate (Edit-T2e). Freeze holds (Edit-T2c) are wall-clock
 * segments already counted correctly by totalOutputDuration (out - in IS the
 * hold length), and applyClips scales freeze holds by the same 1/rate factor
 * it uses for setpts/atempo on ordinary clips — so one division covers both,
 * matching ARCHITECTURE.md's "compose" note for T2c + T2e. Music beds
 * (Edit-T2e) never change duration — the mix is amix duration=first against
 * the video — so they are not a parameter here.
 */
function expectedOutputDuration(
  clips: LegacyClip[],
  { rate, fallbackDuration }: { rate?: number | null; fallbackDuration?: number | null } = {},
): number {
  const raw = totalOutputDuration(clips, fallbackDuration);
  const factor = rate && rate !== 1 ? Number(rate) : 1;
  return raw / factor;
}

/**
 * Tolerance for comparing a probed output duration against
 * expectedOutputDuration. 0.5s floor absorbs container/keyframe rounding on
 * short exports; 3% covers frame-rounding drift that grows with length.
 * Both bounds are far under the failures this guards against — a
 * segment-count-guessed stitch or a transcription that ate 297s are an
 * order of magnitude past either one, so a legitimate render never trips it.
 */
const DURATION_TOLERANCE_FLOOR_SEC = 0.5;
const DURATION_TOLERANCE_RATIO = 0.03;

function durationTolerance(expectedSec: number): number {
  return Math.max(DURATION_TOLERANCE_FLOOR_SEC, Math.abs(expectedSec) * DURATION_TOLERANCE_RATIO);
}

export { expectedOutputDuration, durationTolerance };
