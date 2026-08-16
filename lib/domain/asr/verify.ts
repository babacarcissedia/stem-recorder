'use strict';

/**
 * Post-transcription sanity checks. A decoder that locks onto a filler word
 * exits 0 and writes a complete-looking transcript — measured 2026-08-15:
 * whisper-large-v3 transcribed the first 283s of a 9m41s recording correctly,
 * then emitted "Yeah" for the remaining ~298s, one cue after another, with
 * real speech underneath (volumedetect: mean -24.3dB, max -0.2dB). Coverage
 * and repetition catch that without needing to listen to the audio.
 *
 * Flagged, not thrown (see lib/transcribe.js runLocal/runCloud): the first
 * part of a looped transcript is still real, usable work, and the caller
 * (studio.js) already has a cue-edit UI to fix the flagged tail by hand.
 */

// last cue must miss BOTH more than this fraction of the audio AND more than
// this many seconds — short files losing a few trailing seconds is normal
// (trailing silence, a clipped word) and should not flag.
const MAX_MISSING_COVERAGE_RATIO = 0.15;
const MAX_MISSING_COVERAGE_SECONDS = 20;

// Consecutive identical cues at/above this count is a loop. A verbal tic
// ("Okay.") repeats scattered through a file, rarely more than 2-3 times in a
// row; a stuck decoder repeats it dozens to hundreds of times in a row.
const LOOP_RUN_THRESHOLD = 8;

export type Cue = { text: string; start?: number; end?: number } & Record<string, unknown>;

type LongestRun = { text: string | null; count: number; startIndex: number };

type CoverageStats =
  | { audioDurationSec: null; lastCueEnd: null; missingSeconds: null; missingRatio: null; short: false }
  | { audioDurationSec: number; lastCueEnd: number; missingSeconds: number; missingRatio: number; short: boolean };

type RepetitionStats = {
  uniqueTexts: number;
  repeatedTexts: number;
  longestRun: number;
  longestRunText: string | null;
  longestRunStart: number;
  loop: boolean;
};

/** Longest run of consecutive cues sharing the same text. */
function longestConsecutiveRun(cues: Cue[]): LongestRun {
  let best: LongestRun = { text: null, count: 0, startIndex: -1 };
  let current: string | null = null;
  let count = 0;
  cues.forEach((cue, i) => {
    if (current !== null && cue.text === current) {
      count += 1;
    } else {
      current = cue.text;
      count = 1;
    }
    if (count > best.count) best = { text: current, count, startIndex: i - count + 1 };
  });
  return best;
}

function repetitionStats(cues: Cue[]): RepetitionStats {
  const counts = new Map<string, number>();
  for (const cue of cues) counts.set(cue.text, (counts.get(cue.text) || 0) + 1);
  const repeatedTexts = [...counts.values()].filter((n) => n > 1).length;
  const run = longestConsecutiveRun(cues);
  return {
    uniqueTexts: counts.size,
    repeatedTexts,
    longestRun: run.count,
    longestRunText: run.text,
    longestRunStart: run.startIndex,
    loop: run.count >= LOOP_RUN_THRESHOLD,
  };
}

/** audioDurationSec may be null (ffprobe unavailable) — coverage is skipped, never flagged, in that case. */
function coverageStats(cues: Cue[], audioDurationSec: number | null): CoverageStats {
  if (!(audioDurationSec !== null && audioDurationSec > 0)) {
    return {
      audioDurationSec: null, lastCueEnd: null, missingSeconds: null, missingRatio: null, short: false,
    };
  }
  const lastCueEnd = cues.length ? Math.max(...cues.map((c) => Number(c.end) || 0)) : 0;
  const missingSeconds = Math.max(0, audioDurationSec - lastCueEnd);
  const missingRatio = missingSeconds / audioDurationSec;
  const short = missingRatio > MAX_MISSING_COVERAGE_RATIO && missingSeconds > MAX_MISSING_COVERAGE_SECONDS;
  return {
    audioDurationSec, lastCueEnd, missingSeconds, missingRatio, short,
  };
}

/**
 * Verify one transcript's cues against the source audio's real duration.
 * Returns { ok, reasons, coverage, repetition } — always present, never
 * throws, so a failed verification can never be silently dropped by a
 * caller that forgets to check a boolean.
 */
function verifyTranscript(cues: Cue[], audioDurationSec: number | null) {
  const coverage = coverageStats(cues, audioDurationSec);
  const repetition = repetitionStats(cues);
  const reasons = [];
  if (coverage.short) {
    reasons.push(
      `coverage: last cue ends at ${coverage.lastCueEnd.toFixed(1)}s but the audio is `
      + `${coverage.audioDurationSec.toFixed(1)}s (${coverage.missingSeconds.toFixed(1)}s / `
      + `${Math.round(coverage.missingRatio * 100)}% missing)`
    );
  }
  if (repetition.loop) {
    reasons.push(
      `repetition: "${repetition.longestRunText}" repeats ${repetition.longestRun} times in a row `
      + `starting at cue ${repetition.longestRunStart}`
    );
  }
  return {
    ok: reasons.length === 0, reasons, coverage, repetition,
  };
}

export {
  verifyTranscript,
  coverageStats,
  repetitionStats,
  longestConsecutiveRun,
  LOOP_RUN_THRESHOLD,
  MAX_MISSING_COVERAGE_RATIO,
  MAX_MISSING_COVERAGE_SECONDS,
};
