#!/usr/bin/env node
import assert from 'node:assert';

import { InvariantError } from '../lib/domain/invariant.ts';
import { assertMs, formatTimecode, msToSeconds, secondsToMs } from '../lib/domain/ms.ts';
import { constant, evaluate, keyed } from '../lib/domain/animatable.ts';
import { IDENTITY_TRANSFORM, isIdentityTransform, makeTransform } from '../lib/domain/transform.ts';
import { EffectStack, normalizeRect, normalizeSpeedRate, rectsEqual } from '../lib/domain/effects.ts';
import { Clip, MIN_CLIP_DURATION } from '../lib/domain/clip.ts';
import { Track } from '../lib/domain/track.ts';
import { Timeline } from '../lib/domain/timeline.ts';
import { Selection } from '../lib/domain/selection.ts';
import { makeSource, resolveAudioRoute } from '../lib/domain/source.ts';
import { makeOutputTarget } from '../lib/domain/output-target.ts';
import { Project } from '../lib/domain/project.ts';

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

const screen = makeSource({
  id: 'src-screen',
  path: 'screen.mp4',
  label: 'screen.mp4',
  kind: 'video',
  availableDuration: 600_000,
});
const cam = makeSource({
  id: 'src-cam',
  path: 'cam.mp4',
  label: 'cam.mp4',
  kind: 'video',
  availableDuration: 600_000,
  hasAudio: true,
});
const mic = makeSource({
  id: 'src-mic',
  path: 'audio.mp3',
  label: 'audio.mp3',
  kind: 'audio',
  availableDuration: 600_000,
  hasAudio: true,
});

const clip = (id: string, sourceId: string, timelineStart: number, duration: number, sourceIn = timelineStart) =>
  new Clip({ id, sourceId, timelineStart, duration, sourceIn });

group('milliseconds are integers everywhere', () => {
  assert.strictEqual(assertMs(10, 'x'), 10);
  assert.strictEqual(code(() => assertMs(10.5, 'x')), 'MS_NOT_INTEGER');
  assert.strictEqual(code(() => assertMs(Number.NaN, 'x')), 'MS_NOT_FINITE');
  assert.strictEqual(code(() => clip('c', 'src-screen', 0.5, 1000)), 'MS_NOT_INTEGER');
  assert.strictEqual(code(() => clip('c', 'src-screen', 0, 1000.25)), 'MS_NOT_INTEGER');
  assert.strictEqual(code(() => clip('c', 'src-screen', 0, 1000, 12.75)), 'MS_NOT_INTEGER');
  assert.strictEqual(code(() => clip('c', 'src-screen', -1, 1000, 0)), 'MS_NEGATIVE');
  assert.strictEqual(code(() => clip('c', 'src-screen', 0, 0, 0)), 'MS_NOT_POSITIVE');
  assert.strictEqual(secondsToMs(1.2345), 1235);
  assert.strictEqual(msToSeconds(1235), 1.235);
  assert.strictEqual(formatTimecode(0), '00:00.000');
  assert.strictEqual(formatTimecode(65_432), '01:05.432');
  assert.strictEqual(formatTimecode(600_000), '10:00.000');
});

group('four-point round-trip', () => {
  const c = Clip.fourPoint({
    id: 'c1',
    sourceId: 'src-screen',
    timelineStart: 4_000,
    sourceIn: 10_000,
    sourceOut: 22_500,
  });
  assert.strictEqual(c.duration, 12_500);
  assert.strictEqual(c.sourceOut, 22_500);
  assert.strictEqual(c.timelineEnd, 16_500);

  const again = Clip.fourPoint({
    id: c.id,
    sourceId: c.sourceId,
    timelineStart: c.timelineStart,
    sourceIn: c.sourceIn,
    sourceOut: c.sourceOut,
  });
  assert.deepStrictEqual(again.toJSON(), c.toJSON());

  const rehydrated = Clip.fromJSON(c.toJSON());
  assert.strictEqual(rehydrated.timelineStart, c.timelineStart);
  assert.strictEqual(rehydrated.duration, c.duration);
  assert.strictEqual(rehydrated.sourceIn, c.sourceIn);
  assert.strictEqual(rehydrated.sourceOut, c.sourceOut);

  assert.strictEqual(code(() => Clip.fourPoint({
    id: 'bad', sourceId: 'src-screen', timelineStart: 0, sourceIn: 500, sourceOut: 500,
  })), 'SOURCE_OUT_BEFORE_IN');
});

group('source/timeline mapping is the one canonical pair', () => {
  const c = clip('c1', 'src-screen', 4_000, 10_000, 30_000);
  assert.strictEqual(c.sourceTimeAt(4_000), 30_000);
  assert.strictEqual(c.sourceTimeAt(9_000), 35_000);
  assert.strictEqual(c.sourceTimeAt(1_000), 30_000);
  assert.strictEqual(c.sourceTimeAt(99_000), 40_000);
  assert.strictEqual(c.timelineTimeAt(35_000), 9_000);
  assert.strictEqual(c.timelineTimeAt(c.sourceTimeAt(7_777)), 7_777);
  assert.strictEqual(c.contains(4_000), true);
  assert.strictEqual(c.contains(14_000), false);
});

group('speed breaks the 1:1 and sourceOut goes through the stack', () => {
  const stack = new EffectStack([
    { id: 'fx-speed', type: 'speed', enabled: true, params: { rate: 2 } },
  ]);
  const c = new Clip({
    id: 'c1', sourceId: 'src-screen', timelineStart: 0, duration: 5_000, sourceIn: 1_000, effects: stack,
  });
  assert.strictEqual(c.sourceOut, 11_000);
  assert.strictEqual(c.sourceTimeAt(2_500), 6_000);
  assert.strictEqual(c.timelineTimeAt(6_000), 2_500);
  assert.strictEqual(normalizeSpeedRate(1), null);
  assert.strictEqual(normalizeSpeedRate(9), 4);
  assert.strictEqual(normalizeSpeedRate(0.1), 0.25);
  assert.strictEqual(normalizeSpeedRate(''), null);
  assert.strictEqual(normalizeSpeedRate('abc'), null);
  assert.strictEqual(
    code(() => new EffectStack([{ id: 'x', type: 'speed', enabled: true, params: { rate: 12 } }])),
    'SPEED_RATE_OUT_OF_RANGE',
  );
});

group('nonintegral speed mappings preserve selected source boundaries', () => {
  const speed = (rate: number) => new EffectStack([
    { id: `fx-speed-${rate}`, type: 'speed', enabled: true, params: { rate } },
  ]);

  const onePointFive = new Clip({
    id: 'speed-15', sourceId: 'src-screen', timelineStart: 0, duration: 2, sourceIn: 0, effects: speed(1.5),
  });
  const [onePointFiveLeft, onePointFiveRight] = onePointFive.splitAt(1, 'speed-15-right');
  assert.strictEqual(onePointFive.sourceOut, 3);
  assert.strictEqual(onePointFiveLeft.sourceOut, 2);
  assert.strictEqual(onePointFiveRight.sourceIn, 2);
  assert.strictEqual(onePointFiveRight.sourceOut, 3);

  const onePointFiveFourPoint = Clip.fourPoint({
    id: 'speed-15-four-point', sourceId: 'src-screen', timelineStart: 0, sourceIn: 0, sourceOut: 1, effects: speed(1.5),
  });
  assert.strictEqual(onePointFiveFourPoint.duration, 1);
  assert.strictEqual(onePointFiveFourPoint.sourceOut, 1);
  assert.strictEqual(Clip.fromJSON(onePointFiveFourPoint.toJSON()).sourceOut, 1);

  const onePointTwoFive = new Clip({
    id: 'speed-125', sourceId: 'src-screen', timelineStart: 0, duration: 2, sourceIn: 0, effects: speed(1.25),
  });
  const [onePointTwoFiveLeft, onePointTwoFiveRight] = onePointTwoFive.splitAt(1, 'speed-125-right');
  assert.strictEqual(onePointTwoFive.sourceOut, 3);
  assert.strictEqual(onePointTwoFiveLeft.sourceOut, 1);
  assert.strictEqual(onePointTwoFiveRight.sourceIn, 1);
  assert.strictEqual(onePointTwoFiveRight.sourceOut, 3);

  const onePointTwoFiveFourPoint = Clip.fourPoint({
    id: 'speed-125-four-point', sourceId: 'src-screen', timelineStart: 0, sourceIn: 3, sourceOut: 5, effects: speed(1.25),
  });
  assert.strictEqual(onePointTwoFiveFourPoint.duration, 2);
  assert.strictEqual(onePointTwoFiveFourPoint.sourceOut, 5);
});
group('freeze is an effect holding one source frame', () => {
  const stack = new EffectStack([{ id: 'fx-f', type: 'freeze', enabled: true, params: {} }]);
  const c = new Clip({
    id: 'frz', sourceId: 'src-screen', timelineStart: 10_000, duration: 1_500, sourceIn: 42_000, effects: stack,
  });
  assert.strictEqual(c.sourceOut, 42_000);
  assert.strictEqual(c.sourceTimeAt(10_000), 42_000);
  assert.strictEqual(c.sourceTimeAt(11_400), 42_000);
  assert.strictEqual(code(() => c.splitAt(10_700)), 'CANNOT_SPLIT_FREEZE');
  assert.strictEqual(code(() => Clip.fourPoint({
    id: 'f2', sourceId: 'src-screen', timelineStart: 0, sourceIn: 0, sourceOut: 1_000, effects: stack,
  })), 'FREEZE_HAS_NO_SOURCE_SPAN');
});

group('split preserves the four points across the cut', () => {
  const c = clip('c1', 'src-screen', 0, 10_000, 5_000);
  const [left, right] = c.splitAt(4_000, 'c2');
  assert.strictEqual(left.timelineStart, 0);
  assert.strictEqual(left.duration, 4_000);
  assert.strictEqual(left.sourceIn, 5_000);
  assert.strictEqual(left.sourceOut, 9_000);
  assert.strictEqual(right.timelineStart, 4_000);
  assert.strictEqual(right.duration, 6_000);
  assert.strictEqual(right.sourceIn, 9_000);
  assert.strictEqual(right.sourceOut, 15_000);
  assert.strictEqual(left.duration + right.duration, c.duration);
  assert.strictEqual(code(() => c.splitAt(0)), 'SPLIT_OUTSIDE_CLIP');
  assert.strictEqual(code(() => c.splitAt(10_000)), 'SPLIT_OUTSIDE_CLIP');
  assert.strictEqual(code(() => c.splitAt(12_000)), 'SPLIT_OUTSIDE_CLIP');
});

group('Track.insert rejects overlap and accepts touching', () => {
  const track = new Track({ id: 'trk-a', kind: 'video' });
  track.insert(clip('a', 'src-screen', 0, 5_000, 0));
  track.insert(clip('b', 'src-screen', 5_000, 5_000, 5_000));
  assert.strictEqual(track.clips.length, 2);
  assert.strictEqual(track.duration, 10_000);
  assert.strictEqual(code(() => track.insert(clip('c', 'src-screen', 4_999, 1_000, 0))), 'OVERLAP');
  assert.strictEqual(code(() => track.insert(clip('d', 'src-screen', 0, 100, 0))), 'OVERLAP');
  assert.strictEqual(code(() => track.insert(clip('a', 'src-screen', 90_000, 100, 0))), 'DUPLICATE_CLIP_ID');
  track.insert(clip('e', 'src-screen', 20_000, 1_000, 0));
  assert.deepStrictEqual(track.clips.map((each) => each.id), ['a', 'b', 'e']);
  track.insert(clip('z', 'src-screen', 12_000, 1_000, 0));
  assert.deepStrictEqual(track.clips.map((each) => each.id), ['a', 'b', 'z', 'e']);
});

group('Track neighbours, lookup, ranges and removal', () => {
  const track = new Track({ id: 'trk-a', kind: 'video', clips: [
    clip('a', 'src-screen', 0, 5_000, 0),
    clip('b', 'src-screen', 5_000, 5_000, 5_000),
    clip('c', 'src-screen', 12_000, 3_000, 0),
  ] });
  assert.strictEqual(track.clipAt(6_000)?.id, 'b');
  assert.strictEqual(track.clipAt(11_000), null);
  assert.strictEqual(track.clipAt(10_000), null);
  assert.deepStrictEqual(track.clipsInRange(4_000, 6_000).map((each) => each.id), ['a', 'b']);
  assert.deepStrictEqual(track.clipsFrom(5_000).map((each) => each.id), ['b', 'c']);
  assert.deepStrictEqual(track.neighbours('b'), { before: track.clip('a'), after: track.clip('c') });
  assert.strictEqual(track.neighbours('a').before, null);
  assert.deepStrictEqual(track.editPoints(), [0, 5_000, 10_000, 12_000, 15_000]);
  assert.strictEqual(track.remove('b').id, 'b');
  assert.strictEqual(track.has('b'), false);
  assert.strictEqual(code(() => track.remove('b')), 'CLIP_NOT_ON_TRACK');
});

group('Track.replace restores the original when the new position overlaps', () => {
  const track = new Track({ id: 'trk-a', kind: 'video', clips: [
    clip('a', 'src-screen', 0, 5_000, 0),
    clip('b', 'src-screen', 6_000, 2_000, 0),
  ] });
  assert.strictEqual(code(() => track.replace(track.clip('b').with({ timelineStart: 1_000 }))), 'OVERLAP');
  assert.strictEqual(track.clip('b').timelineStart, 6_000);
  track.replace(track.clip('b').with({ timelineStart: 5_000 }));
  assert.strictEqual(track.clip('b').timelineStart, 5_000);
});

group('per-track selection is independent', () => {
  const timeline = new Timeline({ takeId: 'take-x', sources: [screen, cam, mic] });
  timeline.addTrack(new Track({ id: 'trk-cam', kind: 'video', clips: [
    clip('cam-1', 'src-cam', 0, 5_000, 0), clip('cam-2', 'src-cam', 5_000, 5_000, 5_000),
  ] }));
  timeline.addTrack(new Track({ id: 'trk-screen', kind: 'video', clips: [
    clip('scr-1', 'src-screen', 0, 5_000, 0), clip('scr-2', 'src-screen', 5_000, 5_000, 5_000),
  ] }));
  timeline.addTrack(new Track({ id: 'trk-mic', kind: 'audio', clips: [
    clip('mic-1', 'src-mic', 0, 10_000, 0),
  ] }));

  const one = Selection.empty().select({ trackId: 'trk-screen', clipId: 'scr-1' });
  assert.strictEqual(one.clips.length, 1);
  assert.deepStrictEqual(one.tracksTouched(), ['trk-screen']);
  assert.strictEqual(one.has({ trackId: 'trk-cam', clipId: 'cam-1' }), false);
  assert.strictEqual(one.onTrack('trk-cam').length, 0);
  assert.strictEqual(one.sameTrack(), true);
  assert.deepStrictEqual(one.focus, { trackId: 'trk-screen', clipId: 'scr-1' });

  const two = one.add({ trackId: 'trk-cam', clipId: 'cam-1' });
  assert.strictEqual(two.clips.length, 2);
  assert.strictEqual(two.sameTrack(), false);
  assert.deepStrictEqual(two.tracksTouched().sort(), ['trk-cam', 'trk-screen']);
  assert.strictEqual(one.clips.length, 1);

  assert.strictEqual(two.toggle({ trackId: 'trk-cam', clipId: 'cam-1' }).clips.length, 1);
  assert.strictEqual(two.add({ trackId: 'trk-cam', clipId: 'cam-1' }).clips.length, 2);

  const positional = timeline.clipsAt(2_000);
  assert.strictEqual(positional.length, 3);
  assert.strictEqual(new Selection([positional[0]!]).clips.length, 1);

  assert.strictEqual(Selection.empty().isEmpty(), true);
  const ranged = Selection.empty().withRange(1_000, 4_000);
  assert.strictEqual(ranged.isEmpty(), false);
  assert.strictEqual(ranged.hasRange(), true);
  assert.strictEqual(Selection.empty().withRange(4_000, 1_000).hasRange(), false);
});

group('Transform is animatable on every clip kind', () => {
  const stillSource = makeSource({ id: 'src-img', kind: 'image', path: 'lower-third.png', availableDuration: 0 });
  const textSource = makeSource({ id: 'src-txt', kind: 'text', path: '', availableDuration: 0 });
  for (const sourceId of ['src-screen', 'src-img', 'src-txt']) {
    const c = clip(`c-${sourceId}`, sourceId, 0, 2_000, 0);
    assert.ok(isIdentityTransform(c.transformAt(0)));
  }
  assert.strictEqual(stillSource.kind, 'image');
  assert.strictEqual(textSource.kind, 'text');

  const pip = makeTransform({ x: 0.62, y: 0.66, scale: 0.28 });
  const c = clip('cam-1', 'src-cam', 0, 4_000, 0).withTransform(constant(pip));
  assert.deepStrictEqual(c.transformAt(2_000), pip);
  assert.strictEqual(isIdentityTransform(c.transformAt(0)), false);

  const animated = clip('cam-2', 'src-cam', 1_000, 4_000, 0).withTransform(
    keyed([
      { at: 2_000, value: makeTransform({ scale: 2 }), ease: 'linear' },
      { at: 0, value: makeTransform({ scale: 1 }), ease: 'linear' },
    ]),
  );
  assert.strictEqual(animated.transformAt(1_000).scale, 1);
  assert.strictEqual(animated.transformAt(3_500).scale, 2);
  assert.strictEqual(evaluate(constant(7), 999), 7);

  assert.deepStrictEqual(makeTransform(), IDENTITY_TRANSFORM);
  assert.strictEqual(makeTransform({ rotation: -90 }).rotation, 270);
  assert.strictEqual(makeTransform({ rotation: 450 }).rotation, 90);
  assert.strictEqual(code(() => makeTransform({ scale: 0 })), 'TRANSFORM_SCALE_NOT_POSITIVE');
  assert.strictEqual(code(() => makeTransform({ opacity: 1.5 })), 'TRANSFORM_OPACITY_OUT_OF_RANGE');
  assert.strictEqual(code(() => makeTransform({ x: Number.NaN })), 'TRANSFORM_NOT_FINITE');
});

group('an overlay is a clip on a track, not an effect entry', () => {
  const overlaySource = makeSource({ id: 'src-title', kind: 'text', path: '', availableDuration: 0 });
  const timeline = new Timeline({ takeId: 't', sources: [screen, overlaySource] });
  timeline.addTrack(new Track({ id: 'trk-screen', kind: 'video', clips: [clip('scr-1', 'src-screen', 0, 20_000, 0)] }));
  const overlayTrack = timeline.addTrack(new Track({ id: 'trk-title', kind: 'video' }));
  overlayTrack.insert(new Clip({
    id: 'title-1', sourceId: 'src-title', timelineStart: 3_000, duration: 2_000, sourceIn: 0,
    transform: constant(makeTransform({ y: 0.8, opacity: 0.9 })),
  }));
  assert.strictEqual(timeline.clipsAt(3_500).length, 2);
  assert.strictEqual(timeline.clipsAt(1_000).length, 1);
  assert.strictEqual(timeline.clip({ trackId: 'trk-title', clipId: 'title-1' }).transformAt(3_000).opacity, 0.9);
  assert.strictEqual(timeline.clip({ trackId: 'trk-screen', clipId: 'scr-1' }).effects.list.length, 0);
});

group('nothing hardcodes three tracks', () => {
  const timeline = new Timeline();
  assert.strictEqual(timeline.trackCount, 0);
  assert.strictEqual(timeline.duration, 0);
  assert.deepStrictEqual(timeline.editPoints(), []);
  timeline.addSource(screen);
  for (let index = 0; index < 7; index += 1) {
    timeline.addTrack(new Track({ id: `trk-${index}`, kind: index % 2 === 0 ? 'video' : 'audio' }));
  }
  assert.strictEqual(timeline.trackCount, 7);
  timeline.track('trk-3').insert(clip('x', 'src-screen', 1_000, 9_000, 0));
  assert.strictEqual(timeline.duration, 10_000);
  timeline.moveTrack('trk-6', 0);
  assert.strictEqual(timeline.tracks[0]!.id, 'trk-6');
  timeline.removeTrack('trk-0');
  assert.strictEqual(timeline.trackCount, 6);
  assert.strictEqual(code(() => timeline.track('trk-0')), 'TRACK_NOT_FOUND');
  assert.strictEqual(code(() => timeline.addTrack(new Track({ id: 'trk-1', kind: 'audio' }))), 'DUPLICATE_TRACK_ID');
  timeline.normalize();
});

group('timeline rejects duplicate source IDs on construction and mutation', () => {
  const duplicateScreen = makeSource({
    id: 'src-screen',
    path: 'screen-copy.mp4',
    label: 'screen-copy.mp4',
    kind: 'video',
    availableDuration: 600_000,
  });

  assert.strictEqual(
    code(() => new Timeline({ takeId: 't', sources: [screen, duplicateScreen] })),
    'DUPLICATE_SOURCE_ID',
  );

  const timeline = new Timeline({ takeId: 't', sources: [screen] });
  assert.strictEqual(code(() => timeline.addSource(duplicateScreen)), 'DUPLICATE_SOURCE_ID');
});

group('normalize enforces sources, overlap and marker range', () => {
  const timeline = new Timeline({ takeId: 't', sources: [screen] });
  timeline.addTrack(new Track({ id: 'trk-a', kind: 'video', clips: [clip('a', 'src-screen', 0, 10_000, 0)] }));
  timeline.markers = [
    { id: 'm1', at: 5_000, label: 'mid', color: '#fff', kind: 'marker' },
    { id: 'm2', at: 90_000, label: 'past the end', color: '#fff', kind: 'chapter' },
    { id: 'm0', at: 0, label: 'top', color: '#fff', kind: 'marker' },
  ];
  timeline.normalize();
  assert.deepStrictEqual(timeline.markers.map((marker) => marker.id), ['m0', 'm1']);

  const orphan = new Timeline({ takeId: 't', sources: [screen] });
  orphan.addTrack(new Track({ id: 'trk-a', kind: 'video', clips: [clip('a', 'src-missing', 0, 1_000, 0)] }));
  assert.strictEqual(code(() => orphan.normalize()), 'SOURCE_NOT_FOUND');

  const beyond = new Timeline({ takeId: 't', sources: [screen] });
  beyond.addTrack(new Track({ id: 'trk-a', kind: 'video', clips: [clip('a', 'src-screen', 0, 1_000, 599_500)] }));
  assert.strictEqual(code(() => beyond.normalize()), 'SOURCE_OUT_BEYOND_SOURCE');
});

group('Project carries outputs, never a vertical boolean', () => {
  const timeline = new Timeline({ takeId: 'take-x', sources: [screen, cam, mic] });
  timeline.addTrack(new Track({ id: 'trk-cam', kind: 'video', clips: [clip('cam-1', 'src-cam', 0, 8_000, 0)] }));
  const project = new Project({
    timeline,
    outputs: [
      makeOutputTarget({ id: 'out-h', name: 'Horizontal', width: 1920, height: 1080 }),
      makeOutputTarget({ id: 'out-v', name: 'Vertical', width: 1080, height: 1920, enabled: false }),
    ],
  });
  assert.strictEqual('vertical' in (project as unknown as Record<string, unknown>), false);
  assert.strictEqual(project.outputs.length, 2);
  assert.strictEqual(project.enabledOutputs.length, 1);
  assert.strictEqual(project.output('out-h').aspect, '16:9');
  assert.strictEqual(project.output('out-v').aspect, '9:16');
  assert.deepStrictEqual(evaluate(project.output('out-h').framing, 0), { x: 0, y: 0, w: 1, h: 1 });
  project.addOutput(makeOutputTarget({ id: 'out-sq', width: 1080, height: 1080 }));
  assert.strictEqual(project.output('out-sq').aspect, '1:1');
  assert.strictEqual(code(() => project.addOutput(makeOutputTarget({ id: 'out-h', width: 10, height: 10 }))), 'DUPLICATE_OUTPUT_ID');
  assert.strictEqual(code(() => makeOutputTarget({ id: 'bad', width: 0, height: 10 })), 'OUTPUT_WIDTH_INVALID');
  assert.strictEqual(project.removeOutput('out-sq').id, 'out-sq');
  assert.deepStrictEqual(project.tracks.map((track) => track.id), ['trk-cam']);
});

group('audio route resolves the separate mic file before video sources', () => {
  assert.strictEqual(resolveAudioRoute([screen, cam, mic]), 'src-mic');
  assert.strictEqual(resolveAudioRoute([screen, mic]), 'src-mic');
  assert.strictEqual(resolveAudioRoute([screen]), null);
  const otherVideo = makeSource({ id: 'src-broll', kind: 'video', label: 'b-roll.mov', hasAudio: true, availableDuration: 1_000 });
  assert.strictEqual(resolveAudioRoute([screen, otherVideo, mic]), 'src-mic');
  assert.strictEqual(resolveAudioRoute([{ ...cam, present: false }, mic]), 'src-mic');

  const project = new Project({
    timeline: new Timeline({ takeId: 't', sources: [screen, cam, mic] }),
    audioRoute: { activeSourceId: 'src-screen', resolvedBy: 'user' },
  });
  project.normalize();
  assert.deepStrictEqual(project.audioRoute, { activeSourceId: 'src-mic', resolvedBy: 'auto' });

  const pinned = new Project({
    timeline: new Timeline({ takeId: 't', sources: [screen, cam, mic] }),
    audioRoute: { activeSourceId: 'src-mic', resolvedBy: 'user' },
  });
  pinned.normalize();
  assert.deepStrictEqual(pinned.audioRoute, { activeSourceId: 'src-mic', resolvedBy: 'user' });
});

group('project JSON round-trips through plain JSON', () => {
  const timeline = new Timeline({ takeId: 'take-rt', sources: [screen, cam, mic] });
  timeline.addTrack(new Track({ id: 'trk-cam', kind: 'video', showWaveform: true, clips: [
    new Clip({
      id: 'cam-1', sourceId: 'src-cam', timelineStart: 0, duration: 4_000, sourceIn: 1_000,
      label: 'cam.mp4', transform: constant(makeTransform({ x: 0.6, scale: 0.3 })),
      effects: [{ id: 'fx-mirror', type: 'mirror', enabled: true, params: {} }],
    }),
  ] }));
  timeline.addTrack(new Track({ id: 'trk-mic', kind: 'audio', clips: [clip('mic-1', 'src-mic', 0, 9_000, 0)] }));
  timeline.markers = [{ id: 'm1', at: 2_000, label: 'intro', color: '#c9a227', kind: 'chapter' }];

  const project = new Project({
    timeline,
    outputs: [makeOutputTarget({ id: 'out-h', width: 1920, height: 1080 })],
    audioRoute: { activeSourceId: 'src-cam', resolvedBy: 'auto' },
  });
  project.normalize();

  const wire = JSON.parse(JSON.stringify(project.toJSON()));
  const restored = Project.fromJSON(wire);
  assert.deepStrictEqual(restored.toJSON(), project.toJSON());
  assert.strictEqual(restored.timeline.trackCount, 2);
  assert.strictEqual(restored.timeline.duration, 9_000);
  assert.strictEqual(restored.timeline.clip({ trackId: 'trk-cam', clipId: 'cam-1' }).sourceOut, 5_000);
  assert.strictEqual(restored.timeline.clip({ trackId: 'trk-cam', clipId: 'cam-1' }).transformAt(0).x, 0.6);
  assert.strictEqual(restored.timeline.markers.length, 1);
  assert.strictEqual(restored.schemaVersion, 2);
  assert.strictEqual(wire.timeline.timebase.unit, 'ms');
  assert.strictEqual(code(() => Project.fromJSON({ ...wire, schemaVersion: 1 })), 'SCHEMA_VERSION_UNSUPPORTED');

  const overlapping = JSON.parse(JSON.stringify(wire));
  overlapping.timeline.tracks[1].clips.push({
    id: 'mic-2', sourceId: 'src-mic', timelineStart: 1_000, duration: 1_000, sourceIn: 0,
  });
  assert.strictEqual(code(() => Project.fromJSON(overlapping)), 'OVERLAP');
});

group('crop rects normalize exactly as the v1 model did', () => {
  assert.strictEqual(normalizeRect(null), null);
  assert.strictEqual(normalizeRect({ x: 0, y: 0, w: 1, h: 1 }), null);
  assert.strictEqual(normalizeRect({ x: 'a', y: 0, w: 1, h: 1 }), null);
  assert.deepStrictEqual(normalizeRect({ x: -1, y: -1, w: 0.5, h: 0.5 }), { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.deepStrictEqual(normalizeRect({ x: 0.2, y: 0.1, w: 9, h: 9 }), { x: 0.2, y: 0.1, w: 0.8, h: 0.9 });
  assert.deepStrictEqual(normalizeRect({ x: 0.1, y: 0.1, w: 0.001, h: 0.001 }), { x: 0.1, y: 0.1, w: 0.05, h: 0.05 });
  assert.deepStrictEqual(normalizeRect({ x: 0.123456, y: 0, w: 0.5, h: 0.5 }), { x: 0.1235, y: 0, w: 0.5, h: 0.5 });
  assert.strictEqual(rectsEqual(null, null), true);
  assert.strictEqual(rectsEqual({ x: 0, y: 0, w: 0.5, h: 0.5 }, null), false);
  assert.strictEqual(rectsEqual({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.5 }), true);
});

group('effect stack signature groups clips for the export planner', () => {
  const mirror = { id: 'fx-1', type: 'mirror', enabled: true, params: {} } as const;
  const a = new EffectStack([mirror]);
  const b = new EffectStack([{ ...mirror, id: 'fx-2' }]);
  assert.strictEqual(a.signature(), b.signature());
  assert.notStrictEqual(a.signature(), new EffectStack([]).signature());
  assert.strictEqual(new EffectStack([{ ...mirror, enabled: false }]).signature(), new EffectStack([]).signature());
  assert.strictEqual(a.has('mirror'), true);
  assert.strictEqual(a.rate, 1);
  assert.strictEqual(a.without('fx-1').list.length, 0);
  assert.strictEqual(a.with({ id: 'fx-1', type: 'rotate', enabled: true, params: { degrees: 90 } }).list.length, 1);
  assert.strictEqual(code(() => new EffectStack([mirror, mirror])), 'DUPLICATE_EFFECT_ID');
  assert.strictEqual(MIN_CLIP_DURATION, 100);
});

console.log(JSON.stringify({ ok: true, cases }));
