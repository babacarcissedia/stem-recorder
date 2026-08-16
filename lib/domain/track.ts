import type { Ms } from './ms.ts';
import type { ClipId, ClipJson } from './clip.ts';
import { Clip } from './clip.ts';
import { invariant } from './invariant.ts';

export type TrackId = string;
export type TrackKind = 'video' | 'audio';

export type TrackInit = {
  id: TrackId;
  kind: TrackKind;
  name?: string;
  clips?: Clip[];
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  heightPx?: number;
  showWaveform?: boolean;
  gainDb?: number;
};

export type TrackJson = {
  id: TrackId;
  kind: TrackKind;
  name: string;
  clips: ClipJson[];
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  heightPx?: number;
  showWaveform?: boolean;
  gainDb?: number;
};

export class Track {
  readonly id: TrackId;
  readonly kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  heightPx: number;
  showWaveform: boolean;
  gainDb: number;

  #clips: Clip[];

  constructor(init: TrackInit) {
    invariant(typeof init.id === 'string' && init.id.length > 0, 'TRACK_ID_REQUIRED');
    invariant(init.kind === 'video' || init.kind === 'audio', 'TRACK_KIND_INVALID', init.id);
    this.id = init.id;
    this.kind = init.kind;
    this.name = init.name ?? init.id;
    this.muted = init.muted ?? false;
    this.hidden = init.hidden ?? false;
    this.locked = init.locked ?? false;
    this.heightPx = init.heightPx ?? 72;
    this.showWaveform = init.showWaveform ?? false;
    this.gainDb = init.gainDb ?? 0;
    this.#clips = [];
    for (const clip of init.clips ?? []) this.insert(clip);
  }

  get clips(): readonly Clip[] {
    return this.#clips;
  }

  get duration(): Ms {
    const last = this.#clips[this.#clips.length - 1];
    return last ? last.timelineEnd : 0;
  }

  has(clipId: ClipId): boolean {
    return this.#clips.some((clip) => clip.id === clipId);
  }

  clip(clipId: ClipId): Clip {
    const found = this.#clips.find((candidate) => candidate.id === clipId);
    invariant(found, 'CLIP_NOT_ON_TRACK', `${clipId}@${this.id}`);
    return found as Clip;
  }

  clipAt(timelineTime: Ms): Clip | null {
    return this.#clips.find((clip) => clip.contains(timelineTime)) ?? null;
  }

  clipsInRange(from: Ms, to: Ms): Clip[] {
    return this.#clips.filter((clip) => clip.timelineStart < to && from < clip.timelineEnd);
  }

  clipsFrom(timelineTime: Ms): Clip[] {
    return this.#clips.filter((clip) => clip.timelineStart >= timelineTime);
  }

  insert(clip: Clip): void {
    invariant(clip instanceof Clip, 'NOT_A_CLIP', this.id);
    invariant(!this.has(clip.id), 'DUPLICATE_CLIP_ID', clip.id);
    for (const existing of this.#clips) {
      invariant(
        !existing.overlaps(clip),
        'OVERLAP',
        `${clip.id} overlaps ${existing.id} on ${this.id}`,
      );
    }
    this.#clips.push(clip);
    this.#clips.sort((a, b) => a.timelineStart - b.timelineStart);
  }

  remove(clipId: ClipId): Clip {
    const index = this.#clips.findIndex((clip) => clip.id === clipId);
    invariant(index >= 0, 'CLIP_NOT_ON_TRACK', `${clipId}@${this.id}`);
    return this.#clips.splice(index, 1)[0] as Clip;
  }

  replace(clip: Clip): void {
    const previous = this.remove(clip.id);
    try {
      this.insert(clip);
    } catch (error) {
      this.insert(previous);
      throw error;
    }
  }

  neighbours(clipId: ClipId): { before: Clip | null; after: Clip | null } {
    const index = this.#clips.findIndex((clip) => clip.id === clipId);
    invariant(index >= 0, 'CLIP_NOT_ON_TRACK', `${clipId}@${this.id}`);
    return {
      before: this.#clips[index - 1] ?? null,
      after: this.#clips[index + 1] ?? null,
    };
  }

  editPoints(): Ms[] {
    const points = new Set<Ms>();
    for (const clip of this.#clips) {
      points.add(clip.timelineStart);
      points.add(clip.timelineEnd);
    }
    return [...points].sort((a, b) => a - b);
  }

  assertInvariants(): void {
    for (let i = 1; i < this.#clips.length; i += 1) {
      const previous = this.#clips[i - 1] as Clip;
      const current = this.#clips[i] as Clip;
      invariant(
        previous.timelineEnd <= current.timelineStart,
        'OVERLAP',
        `${previous.id} / ${current.id} on ${this.id}`,
      );
    }
  }

  toJSON(): TrackJson {
    const json: TrackJson = {
      id: this.id,
      kind: this.kind,
      name: this.name,
      clips: this.#clips.map((clip) => clip.toJSON()),
    };
    if (this.muted) json.muted = true;
    if (this.hidden) json.hidden = true;
    if (this.locked) json.locked = true;
    if (this.heightPx !== 72) json.heightPx = this.heightPx;
    if (this.showWaveform) json.showWaveform = true;
    if (this.gainDb !== 0) json.gainDb = this.gainDb;
    return json;
  }

  static fromJSON(json: TrackJson): Track {
    return new Track({
      id: json.id,
      kind: json.kind,
      name: json.name,
      clips: (json.clips ?? []).map((clip) => Clip.fromJSON(clip)),
      muted: json.muted,
      hidden: json.hidden,
      locked: json.locked,
      heightPx: json.heightPx,
      showWaveform: json.showWaveform,
      gainDb: json.gainDb,
    });
  }
}
