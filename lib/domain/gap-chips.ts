'use strict';

/**
 * Pure gap/retake chip detection for Edit-T1. Dual CJS + browser.
 * Chips are source-time ranges suggesting a cut: silences (waveform peaks),
 * speech gaps (VTT cue spacing), and retakes (repeated similar cue text).
 */
import type { LegacyClip } from './clip-ops.ts';

export type Interval = { start: number; end: number };
export type VttCue = { start: number; end: number; text?: string };
export type ChipOpts = { threshold?: number; minDur?: number; similarity?: number; lookahead?: number };
export type Retake = { start: number; end: number; matchText: string };
export type Chip = { kind: 'gap' | 'retake'; start: number; end: number; label: string };
export type ChipsInput = { peaks?: number[]; peaksPerSec?: number; cues?: VttCue[]; opts?: ChipOpts };
export type ChipOutputSpan = { start: number; end: number };

const api = (() => {
  const SILENCE_THRESHOLD = 0.05;
  const MIN_GAP_SEC = 0.8;
  const MERGE_GAP_SEC = 0.2;
  const RETAKE_SIMILARITY = 0.6;
  const RETAKE_LOOKAHEAD = 2;

  function roundMs(t: number): number {
    return Math.round(Number(t) * 1000) / 1000;
  }

  /** Silence runs in the waveform → [{start, end}] (source time). */
  function detectSilences(
    peaks: number[] | null | undefined,
    peaksPerSec: number | undefined,
    opts: ChipOpts | undefined,
  ): Interval[] {
    const rate = Number(peaksPerSec);
    if (!Array.isArray(peaks) || !peaks.length || !(rate > 0)) return [];
    const threshold = opts?.threshold ?? SILENCE_THRESHOLD;
    const minDur = opts?.minDur ?? MIN_GAP_SEC;
    const runs: Interval[] = [];
    let runStart: number | null = null;
    for (let i = 0; i <= peaks.length; i += 1) {
      const quiet = i < peaks.length && peaks[i] <= threshold;
      if (quiet && runStart == null) runStart = i;
      if (!quiet && runStart != null) {
        const start = runStart / rate;
        const end = i / rate;
        if (end - start >= minDur) runs.push({ start: roundMs(start), end: roundMs(end) });
        runStart = null;
      }
    }
    return runs;
  }

  /** Spacing between consecutive cues → [{start, end}] (source time). */
  function detectCueGaps(cues: VttCue[] | null | undefined, opts: ChipOpts | undefined): Interval[] {
    if (!Array.isArray(cues) || cues.length < 2) return [];
    const minDur = opts?.minDur ?? MIN_GAP_SEC;
    const sorted = [...cues].sort((x, y) => Number(x.start) - Number(y.start));
    const gaps: Interval[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const prevEnd = Number(sorted[i - 1].end);
      const nextStart = Number(sorted[i].start);
      if (Number.isFinite(prevEnd) && Number.isFinite(nextStart) && nextStart - prevEnd >= minDur) {
        gaps.push({ start: roundMs(prevEnd), end: roundMs(nextStart) });
      }
    }
    return gaps;
  }

  function normalizeTokens(text: unknown): string[] {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /** Token Jaccard similarity between two cue texts (0..1). */
  function textSimilarity(a: unknown, b: unknown): number {
    const ta = new Set(normalizeTokens(a));
    const tb = new Set(normalizeTokens(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter += 1;
    return inter / (ta.size + tb.size - inter);
  }

  /**
   * Repeated similar consecutive cues → the EARLIER take as a cut candidate.
   * Returns [{start, end, matchText}] where [start, end] covers the earlier take
   * up to where the repeat begins.
   */
  function detectRetakes(cues: VttCue[] | null | undefined, opts: ChipOpts | undefined): Retake[] {
    if (!Array.isArray(cues) || cues.length < 2) return [];
    const minSim = opts?.similarity ?? RETAKE_SIMILARITY;
    const lookahead = opts?.lookahead ?? RETAKE_LOOKAHEAD;
    const sorted = [...cues].sort((x, y) => Number(x.start) - Number(y.start));
    const retakes: Retake[] = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      for (let j = i + 1; j <= Math.min(i + lookahead, sorted.length - 1); j += 1) {
        if (normalizeTokens(sorted[i].text).length < 3) continue;
        if (textSimilarity(sorted[i].text, sorted[j].text) < minSim) continue;
        const start = Number(sorted[i].start);
        const end = Number(sorted[j].start);
        if (!(end > start + 0.05)) continue;
        retakes.push({
          start: roundMs(start),
          end: roundMs(end),
          matchText: String(sorted[i].text || '').trim(),
        });
        break;
      }
    }
    return retakes;
  }

  /** Union of overlapping/near-touching intervals, sorted by start. */
  function mergeIntervals(intervals: Interval[], joinWithin?: number | null): Interval[] {
    const eps = joinWithin ?? MERGE_GAP_SEC;
    const sorted = [...intervals].sort((x, y) => x.start - y.start);
    const merged: Interval[] = [];
    for (const iv of sorted) {
      const last = merged[merged.length - 1];
      if (last && iv.start <= last.end + eps) {
        last.end = Math.max(last.end, iv.end);
      } else {
        merged.push({ start: iv.start, end: iv.end });
      }
    }
    return merged;
  }

  /**
   * Build the chip list from whatever evidence exists.
   * Gap chips merge silence + cue-gap intervals; retake chips stay separate.
   * Returns [{kind: 'gap'|'retake', start, end, label}] sorted by start.
   */
  function buildChips({ peaks, peaksPerSec, cues, opts }: ChipsInput = {}): Chip[] {
    const gapIntervals = [
      ...detectSilences(peaks, peaksPerSec, opts),
      ...detectCueGaps(cues, opts),
    ];
    const chips: Chip[] = mergeIntervals(gapIntervals).map((iv) => ({
      kind: 'gap' as const,
      start: iv.start,
      end: iv.end,
      label: `${(iv.end - iv.start).toFixed(1)}s gap`,
    }));
    for (const r of detectRetakes(cues, opts)) {
      chips.push({
        kind: 'retake',
        start: r.start,
        end: r.end,
        label: `retake · ${r.matchText.slice(0, 32)}`,
      });
    }
    return chips.sort((x, y) => x.start - y.start);
  }

  /**
   * Map a source-time range onto the output timeline through the clip list.
   * Returns { start, end } in output time covering the kept parts, or null
   * when the whole range was already cut.
   */
  function chipOutputSpan(
    clips: LegacyClip[],
    rangeStart: number,
    rangeEnd: number,
    fallbackDuration?: number | null,
  ): ChipOutputSpan | null {
    let acc = 0;
    let outStart: number | null = null;
    let outEnd: number | null = null;
    for (const c of clips) {
      const cin = Number(c.in) || 0;
      const cout = c.out != null ? Number(c.out) : (fallbackDuration != null ? Number(fallbackDuration) : null);
      if (cout == null || cout <= cin) continue;
      const a = Math.max(cin, rangeStart);
      const b = Math.min(cout, rangeEnd);
      if (b > a) {
        const s = acc + (a - cin);
        const e = acc + (b - cin);
        if (outStart == null || s < outStart) outStart = s;
        if (outEnd == null || e > outEnd) outEnd = e;
      }
      acc += cout - cin;
    }
    if (outStart == null || outEnd == null) return null;
    return { start: roundMs(outStart), end: roundMs(outEnd) };
  }

  return {
    detectSilences,
    detectCueGaps,
    detectRetakes,
    textSimilarity,
    mergeIntervals,
    buildChips,
    chipOutputSpan,
    SILENCE_THRESHOLD,
    MIN_GAP_SEC,
  };
})();

export const {
  detectSilences,
  detectCueGaps,
  detectRetakes,
  textSimilarity,
  mergeIntervals,
  buildChips,
  chipOutputSpan,
  SILENCE_THRESHOLD,
  MIN_GAP_SEC,
} = api;
