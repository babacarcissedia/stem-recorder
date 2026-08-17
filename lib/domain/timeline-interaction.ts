import type { Ms } from './ms.ts';
import { assertMs } from './ms.ts';
import type { ClipRef } from './selection.ts';
import { Selection } from './selection.ts';
import type { Timeline } from './timeline.ts';
import type { TrackId } from './track.ts';
import { invariant } from './invariant.ts';

export type PointerModifiers = {
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
};

export type SelectIntent = 'replace' | 'toggle' | 'extend';

export function intentFor(modifiers: PointerModifiers): SelectIntent {
  if (modifiers.shift) return 'extend';
  if (modifiers.meta || modifiers.ctrl) return 'toggle';
  return 'replace';
}

function extendWithinTrack(timeline: Timeline, selection: Selection, ref: ClipRef): Selection {
  const anchor = selection.focus;
  if (!anchor || anchor.trackId !== ref.trackId) return selection.add(ref);
  const track = timeline.track(ref.trackId);
  const from = track.clips.findIndex((clip) => clip.id === anchor.clipId);
  const to = track.clips.findIndex((clip) => clip.id === ref.clipId);
  invariant(from >= 0 && to >= 0, 'CLIP_NOT_ON_TRACK', `${anchor.clipId}/${ref.clipId}@${ref.trackId}`);
  const span = track.clips.slice(Math.min(from, to), Math.max(from, to) + 1);
  const added = span.map((clip) => ({ trackId: ref.trackId, clipId: clip.id }));
  return new Selection([...selection.clips, ...added], selection.range, ref);
}

export function selectOnPointer(
  timeline: Timeline,
  selection: Selection,
  ref: ClipRef,
  modifiers: PointerModifiers = {},
): Selection {
  timeline.clip(ref);
  switch (intentFor(modifiers)) {
    case 'toggle':
      return selection.toggle(ref);
    case 'extend':
      return extendWithinTrack(timeline, selection, ref);
    default:
      return selection.select(ref);
  }
}

export function tracksWithSelection(selection: Selection): TrackId[] {
  return selection.tracksTouched();
}

export function seekTarget(fractionOfWidth: number, visibleDuration: Ms): Ms {
  invariant(Number.isFinite(fractionOfWidth), 'SEEK_FRACTION_NOT_FINITE');
  const duration = assertMs(visibleDuration, 'visibleDuration');
  invariant(duration >= 0, 'SEEK_DURATION_NEGATIVE', String(duration));
  const clamped = Math.min(Math.max(fractionOfWidth, 0), 1);
  return Math.min(Math.round(clamped * duration), duration);
}

export const EMPTY_TIMELINE_WINDOW: Ms = 10_000;

export function visibleDuration(timeline: Timeline): Ms {
  return timeline.duration > 0 ? timeline.duration : EMPTY_TIMELINE_WINDOW;
}

const TICK_STEPS: Ms[] = [
  250, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
];

export const MAX_RULER_TICKS = 12;

export function rulerTickStep(duration: Ms): Ms {
  const total = assertMs(duration, 'duration');
  invariant(total > 0, 'RULER_DURATION_NOT_POSITIVE', String(total));
  const fitting = TICK_STEPS.find((step) => total / step <= MAX_RULER_TICKS);
  return fitting ?? assertMs(Math.ceil(total / MAX_RULER_TICKS), 'rulerTickStep');
}

export function rulerTicks(duration: Ms): Ms[] {
  const step = rulerTickStep(duration);
  const ticks: Ms[] = [];
  for (let at = 0; at <= duration; at += step) ticks.push(at);
  return ticks;
}
