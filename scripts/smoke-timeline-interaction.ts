#!/usr/bin/env node
import assert from 'node:assert';

import { InvariantError } from '../lib/domain/invariant.ts';
import { Clip } from '../lib/domain/clip.ts';
import { Track } from '../lib/domain/track.ts';
import { Timeline } from '../lib/domain/timeline.ts';
import { Selection } from '../lib/domain/selection.ts';
import { makeSource } from '../lib/domain/source.ts';
import {
  EMPTY_TIMELINE_WINDOW,
  MAX_RULER_TICKS,
  intentFor,
  rulerTickStep,
  rulerTicks,
  seekTarget,
  selectOnPointer,
  visibleDuration,
} from '../lib/domain/timeline-interaction.ts';

let cases = 0;
function group(name: string, body: () => void): void {
  cases += 1;
  try {
    body();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof InvariantError, `expected InvariantError, got ${String(error)}`);
    return (error as InvariantError).code;
  }
  throw new assert.AssertionError({ message: 'expected an InvariantError, none thrown' });
};

const source = makeSource({ id: 'src-a', path: 'a.mp4', kind: 'video', hasAudio: true });

const clip = (id: string, timelineStart: number, duration: number) =>
  new Clip({ id, sourceId: source.id, timelineStart, duration, sourceIn: 0 });

function threeTrackTimeline(): Timeline {
  return new Timeline({
    takeId: 'take-1',
    sources: [source],
    tracks: [
      new Track({
        id: 'screen',
        kind: 'video',
        clips: [clip('screen-1', 0, 4000), clip('screen-2', 4000, 3000), clip('screen-3', 7000, 2000)],
      }),
      new Track({ id: 'cam', kind: 'video', clips: [clip('cam-1', 0, 5000), clip('cam-2', 5000, 4000)] }),
      new Track({ id: 'mic', kind: 'audio', clips: [clip('mic-1', 0, 9000)] }),
    ],
  });
}

group('selecting one clip leaves every other track unselected', () => {
  const timeline = threeTrackTimeline();
  const selection = selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-2' });

  assert.deepStrictEqual(selection.clips, [{ trackId: 'screen', clipId: 'screen-2' }]);
  assert.deepStrictEqual(selection.tracksTouched(), ['screen']);
  assert.strictEqual(selection.sameTrack(), true);
  assert.deepStrictEqual(selection.onTrack('cam'), []);
  assert.deepStrictEqual(selection.onTrack('mic'), []);

  for (const track of timeline.tracks) {
    for (const candidate of track.clips) {
      const ref = { trackId: track.id, clipId: candidate.id };
      const expected = track.id === 'screen' && candidate.id === 'screen-2';
      assert.strictEqual(
        selection.has(ref),
        expected,
        `${track.id}/${candidate.id} should be ${expected ? 'selected' : 'unselected'}`,
      );
    }
  }
});

group('a clip at the same index on another track is not selected with it', () => {
  const timeline = threeTrackTimeline();
  const selection = selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-2' });
  const sameIndexOnCam = timeline.track('cam').clips[1];

  assert.ok(sameIndexOnCam);
  assert.strictEqual(selection.has({ trackId: 'cam', clipId: sameIndexOnCam.id }), false);
  assert.strictEqual(selection.clips.length, 1);
});

group('a second plain click replaces the selection rather than accumulating', () => {
  const timeline = threeTrackTimeline();
  const first = selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-1' });
  const second = selectOnPointer(timeline, first, { trackId: 'cam', clipId: 'cam-1' });

  assert.deepStrictEqual(second.clips, [{ trackId: 'cam', clipId: 'cam-1' }]);
  assert.deepStrictEqual(second.tracksTouched(), ['cam']);
  assert.strictEqual(second.has({ trackId: 'screen', clipId: 'screen-1' }), false);
});

group('toggle adds across tracks and removes only the clip it names', () => {
  const timeline = threeTrackTimeline();
  const first = selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-1' });
  const both = selectOnPointer(timeline, first, { trackId: 'mic', clipId: 'mic-1' }, { meta: true });

  assert.strictEqual(both.clips.length, 2);
  assert.deepStrictEqual(both.tracksTouched(), ['screen', 'mic']);

  const removed = selectOnPointer(timeline, both, { trackId: 'mic', clipId: 'mic-1' }, { ctrl: true });
  assert.deepStrictEqual(removed.clips, [{ trackId: 'screen', clipId: 'screen-1' }]);
});

group('extend spans the anchor track only and never leaks onto a sibling track', () => {
  const timeline = threeTrackTimeline();
  const anchor = selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-1' });
  const spanned = selectOnPointer(timeline, anchor, { trackId: 'screen', clipId: 'screen-3' }, { shift: true });

  assert.deepStrictEqual(spanned.clips, [
    { trackId: 'screen', clipId: 'screen-1' },
    { trackId: 'screen', clipId: 'screen-2' },
    { trackId: 'screen', clipId: 'screen-3' },
  ]);
  assert.deepStrictEqual(spanned.tracksTouched(), ['screen']);
  assert.deepStrictEqual(spanned.onTrack('cam'), []);

  const backwards = selectOnPointer(
    timeline,
    selectOnPointer(timeline, Selection.empty(), { trackId: 'screen', clipId: 'screen-3' }),
    { trackId: 'screen', clipId: 'screen-1' },
    { shift: true },
  );
  assert.strictEqual(backwards.clips.length, 3);
});

group('extend from an anchor on another track adds one clip, it does not span', () => {
  const timeline = threeTrackTimeline();
  const anchor = selectOnPointer(timeline, Selection.empty(), { trackId: 'cam', clipId: 'cam-1' });
  const extended = selectOnPointer(timeline, anchor, { trackId: 'screen', clipId: 'screen-3' }, { shift: true });

  assert.deepStrictEqual(extended.clips, [
    { trackId: 'cam', clipId: 'cam-1' },
    { trackId: 'screen', clipId: 'screen-3' },
  ]);
  assert.strictEqual(extended.has({ trackId: 'screen', clipId: 'screen-1' }), false);
  assert.strictEqual(extended.has({ trackId: 'screen', clipId: 'screen-2' }), false);
});

group('modifiers map to intents with shift winning over meta', () => {
  assert.strictEqual(intentFor({}), 'replace');
  assert.strictEqual(intentFor({ meta: true }), 'toggle');
  assert.strictEqual(intentFor({ ctrl: true }), 'toggle');
  assert.strictEqual(intentFor({ shift: true }), 'extend');
  assert.strictEqual(intentFor({ shift: true, meta: true }), 'extend');
});

group('selecting a clip that is not on the named track is refused', () => {
  const timeline = threeTrackTimeline();
  assert.strictEqual(
    code(() => selectOnPointer(timeline, Selection.empty(), { trackId: 'cam', clipId: 'screen-1' })),
    'CLIP_NOT_ON_TRACK',
  );
  assert.strictEqual(
    code(() => selectOnPointer(timeline, Selection.empty(), { trackId: 'nope', clipId: 'screen-1' })),
    'TRACK_NOT_FOUND',
  );
});

group('a pointer fraction maps to an integer ms inside the timeline', () => {
  assert.strictEqual(seekTarget(0, 9000), 0);
  assert.strictEqual(seekTarget(1, 9000), 9000);
  assert.strictEqual(seekTarget(0.5, 9000), 4500);
  assert.strictEqual(seekTarget(-3, 9000), 0);
  assert.strictEqual(seekTarget(42, 9000), 9000);
  assert.strictEqual(Number.isInteger(seekTarget(1 / 3, 10_000)), true);
  assert.strictEqual(seekTarget(0.5, 0), 0);
  assert.strictEqual(code(() => seekTarget(Number.NaN, 9000)), 'SEEK_FRACTION_NOT_FINITE');
  assert.strictEqual(code(() => seekTarget(0.5, 900.5)), 'MS_NOT_INTEGER');
});

group('an empty timeline still offers a clickable window', () => {
  assert.strictEqual(visibleDuration(new Timeline()), EMPTY_TIMELINE_WINDOW);
  assert.strictEqual(visibleDuration(threeTrackTimeline()), 9000);
  assert.strictEqual(seekTarget(1, visibleDuration(new Timeline())), EMPTY_TIMELINE_WINDOW);
});

group('the ruler never crowds past its tick budget at any timeline length', () => {
  for (const duration of [1_000, 9_000, 60_000, 300_000, 3_600_000, 36_000_000]) {
    const ticks = rulerTicks(duration);
    assert.ok(ticks.length >= 2, `${duration}ms produced ${ticks.length} ticks`);
    assert.ok(ticks.length <= MAX_RULER_TICKS + 1, `${duration}ms produced ${ticks.length} ticks`);
    assert.strictEqual(ticks[0], 0);
    assert.ok(ticks.every((tick) => Number.isInteger(tick)));
    assert.ok((ticks[ticks.length - 1] as number) <= duration);
  }
  assert.strictEqual(rulerTickStep(9_000), 1_000);
  assert.strictEqual(code(() => rulerTickStep(0)), 'RULER_DURATION_NOT_POSITIVE');
});

console.log(JSON.stringify({ ok: true, cases }));
