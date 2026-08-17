import type { Ms } from './ms.ts';
import type { Clip, SourceId } from './clip.ts';
import type { TrackId, TrackJson } from './track.ts';
import { Track } from './track.ts';
import type { ClipRef } from './selection.ts';
import type { Source } from './source.ts';
import { makeSource } from './source.ts';
import { invariant } from './invariant.ts';

export type MarkerId = string;

export type Marker = {
  id: MarkerId;
  at: Ms;
  label: string;
  color: string;
  kind: 'marker' | 'chapter';
};

export type TimelineJson = {
  takeId: string;
  timebase: { unit: 'ms' };
  sources: Record<SourceId, Omit<Source, 'id'>>;
  tracks: TrackJson[];
  markers: Marker[];
};

export class Timeline {
  takeId: string;
  readonly sources: Map<SourceId, Source>;
  readonly tracks: Track[];
  markers: Marker[];

  constructor(init: {
    takeId?: string;
    sources?: Iterable<Source>;
    tracks?: Track[];
    markers?: Marker[];
  } = {}) {
    this.takeId = init.takeId ?? '';
    this.sources = new Map();
    for (const source of init.sources ?? []) this.addSource(source);
    this.tracks = [];
    this.markers = init.markers ?? [];
    for (const track of init.tracks ?? []) this.addTrack(track);
  }

  get duration(): Ms {
    return this.tracks.reduce((longest, track) => Math.max(longest, track.duration), 0);
  }

  get trackCount(): number {
    return this.tracks.length;
  }

  addTrack(track: Track, atIndex?: number): Track {
    invariant(track instanceof Track, 'NOT_A_TRACK');
    invariant(!this.tracks.some((existing) => existing.id === track.id), 'DUPLICATE_TRACK_ID', track.id);
    if (atIndex == null) this.tracks.push(track);
    else this.tracks.splice(Math.max(0, Math.min(atIndex, this.tracks.length)), 0, track);
    return track;
  }

  removeTrack(trackId: TrackId): Track {
    const index = this.tracks.findIndex((track) => track.id === trackId);
    invariant(index >= 0, 'TRACK_NOT_FOUND', trackId);
    return this.tracks.splice(index, 1)[0] as Track;
  }

  moveTrack(trackId: TrackId, toIndex: number): void {
    const track = this.removeTrack(trackId);
    this.addTrack(track, toIndex);
  }

  track(trackId: TrackId): Track {
    const found = this.tracks.find((candidate) => candidate.id === trackId);
    invariant(found, 'TRACK_NOT_FOUND', trackId);
    return found as Track;
  }

  clip(ref: ClipRef): Clip {
    return this.track(ref.trackId).clip(ref.clipId);
  }

  clipsAt(timelineTime: Ms): ClipRef[] {
    const refs: ClipRef[] = [];
    for (const track of this.tracks) {
      const clip = track.clipAt(timelineTime);
      if (clip) refs.push({ trackId: track.id, clipId: clip.id });
    }
    return refs;
  }

  editPoints(): Ms[] {
    const points = new Set<Ms>();
    for (const track of this.tracks) for (const point of track.editPoints()) points.add(point);
    return [...points].sort((a, b) => a - b);
  }

  addSource(source: Source): Source {
    invariant(!this.sources.has(source.id), 'DUPLICATE_SOURCE_ID', source.id);
    this.sources.set(source.id, source);
    return source;
  }

  source(sourceId: SourceId): Source {
    const found = this.sources.get(sourceId);
    invariant(found, 'SOURCE_NOT_FOUND', sourceId);
    return found as Source;
  }

  normalize(): void {
    for (const track of this.tracks) {
      track.assertInvariants();
      for (const clip of track.clips) {
        invariant(this.sources.has(clip.sourceId), 'SOURCE_NOT_FOUND', clip.sourceId);
        const source = this.source(clip.sourceId);
        if (source.availableDuration > 0) {
          invariant(
            clip.sourceOut <= source.availableDuration,
            'SOURCE_OUT_BEYOND_SOURCE',
            `${clip.id} ${clip.sourceOut}>${source.availableDuration}`,
          );
        }
      }
    }
    const end = this.duration;
    this.markers = this.markers
      .filter((marker) => marker.at >= 0 && marker.at <= end)
      .sort((a, b) => a.at - b.at);
  }

  toJSON(): TimelineJson {
    const sources: Record<SourceId, Omit<Source, 'id'>> = {};
    for (const [id, source] of this.sources) {
      const { id: _omitted, ...rest } = source;
      sources[id] = rest;
    }
    return {
      takeId: this.takeId,
      timebase: { unit: 'ms' },
      sources,
      tracks: this.tracks.map((track) => track.toJSON()),
      markers: this.markers,
    };
  }

  static fromJSON(json: TimelineJson): Timeline {
    const sources = Object.entries(json.sources ?? {}).map(([id, rest]) =>
      makeSource({ ...rest, id }),
    );
    const timeline = new Timeline({
      takeId: json.takeId,
      sources,
      tracks: (json.tracks ?? []).map((track) => Track.fromJSON(track)),
      markers: json.markers ?? [],
    });
    timeline.normalize();
    return timeline;
  }
}
