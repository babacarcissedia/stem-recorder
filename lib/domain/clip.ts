import type { Ms } from './ms.ts';
import { assertNonNegativeMs, assertPositiveMs } from './ms.ts';
import type { Animatable } from './animatable.ts';
import { constant, evaluate } from './animatable.ts';
import type { Transform } from './transform.ts';
import { IDENTITY_TRANSFORM, isIdentityTransform, makeTransform } from './transform.ts';
import type { Effect } from './effects.ts';
import { EffectStack } from './effects.ts';
import { invariant } from './invariant.ts';

export type ClipId = string;
export type SourceId = string;
export type LinkGroupId = string;

export const MIN_CLIP_DURATION: Ms = 100;

export type ClipInit = {
  id: ClipId;
  sourceId: SourceId;
  timelineStart: Ms;
  duration: Ms;
  sourceIn: Ms;
  sourceOut?: Ms;
  label?: string;
  enabled?: boolean;
  linkGroupId?: LinkGroupId | null;
  transform?: Animatable<Transform>;
  effects?: EffectStack | Effect[];
};

export type ClipJson = {
  id: ClipId;
  sourceId: SourceId;
  timelineStart: Ms;
  duration: Ms;
  sourceIn: Ms;
  sourceOut?: Ms;
  label?: string;
  enabled?: boolean;
  linkGroup?: LinkGroupId;
  transform?: Animatable<Transform>;
  effects?: Effect[];
};

let clipCounter = 0;

export function newClipId(): ClipId {
  clipCounter += 1;
  return `clip-${Date.now().toString(36)}-${clipCounter}`;
}

export class Clip {
  readonly id: ClipId;
  readonly sourceId: SourceId;
  readonly timelineStart: Ms;
  readonly duration: Ms;
  readonly sourceIn: Ms;
  private readonly sourceOutOverride: Ms | null;
  readonly label: string;
  readonly enabled: boolean;
  readonly linkGroupId: LinkGroupId | null;
  readonly transform: Animatable<Transform>;
  readonly effects: EffectStack;

  constructor(init: ClipInit) {
    invariant(typeof init.id === 'string' && init.id.length > 0, 'CLIP_ID_REQUIRED');
    invariant(
      typeof init.sourceId === 'string' && init.sourceId.length > 0,
      'CLIP_SOURCE_REQUIRED',
      init.id,
    );
    this.id = init.id;
    this.sourceId = init.sourceId;
    this.timelineStart = assertNonNegativeMs(init.timelineStart, 'timelineStart');
    this.duration = assertPositiveMs(init.duration, 'duration');
    this.sourceIn = assertNonNegativeMs(init.sourceIn, 'sourceIn');
    this.sourceOutOverride = init.sourceOut === undefined
      ? null
      : assertNonNegativeMs(init.sourceOut, 'sourceOut');
    this.label = init.label ?? '';
    this.enabled = init.enabled ?? true;
    this.linkGroupId = init.linkGroupId ?? null;
    this.transform = init.transform ?? constant(IDENTITY_TRANSFORM);
    this.effects =
      init.effects instanceof EffectStack ? init.effects : new EffectStack(init.effects ?? []);
    if (this.sourceOutOverride !== null && !this.effects.isFreeze) {
      invariant(
        this.sourceOutOverride > this.sourceIn,
        'SOURCE_OUT_BEFORE_IN',
        `${this.sourceIn}..${this.sourceOutOverride}`,
      );
    }
    assertNonNegativeMs(this.sourceOut, 'sourceOut');
  }

  static fourPoint(init: Omit<ClipInit, 'duration'> & { sourceOut: Ms }): Clip {
    const sourceIn = assertNonNegativeMs(init.sourceIn, 'sourceIn');
    const sourceOut = assertNonNegativeMs(init.sourceOut, 'sourceOut');
    const stack =
      init.effects instanceof EffectStack ? init.effects : new EffectStack(init.effects ?? []);
    invariant(!stack.isFreeze, 'FREEZE_HAS_NO_SOURCE_SPAN', init.id);
    invariant(sourceOut > sourceIn, 'SOURCE_OUT_BEFORE_IN', `${sourceIn}..${sourceOut}`);
    const duration = Math.round((sourceOut - sourceIn) / stack.rate);
    return new Clip({ ...init, effects: stack, duration, sourceOut });
  }

  get timelineEnd(): Ms {
    return this.timelineStart + this.duration;
  }

  get sourceOut(): Ms {
    if (this.effects.isFreeze) return this.sourceIn;
    return this.sourceOutOverride ?? this.sourceIn + Math.round(this.duration * this.effects.rate);
  }

  transformAt(timelineTime: Ms): Transform {
    return makeTransform(evaluate(this.transform, timelineTime - this.timelineStart));
  }

  sourceTimeAt(timelineTime: Ms): Ms {
    const offset = Math.min(Math.max(timelineTime - this.timelineStart, 0), this.duration);
    if (this.effects.isFreeze) return this.sourceIn;
    if (this.sourceOutOverride !== null) {
      return this.sourceIn + Math.round(offset * (this.sourceOut - this.sourceIn) / this.duration);
    }
    return this.sourceIn + Math.round(offset * this.effects.rate);
  }

  timelineTimeAt(sourceTime: Ms): Ms {
    if (this.effects.isFreeze) return this.timelineStart;
    const rate = this.sourceOutOverride === null
      ? this.effects.rate
      : (this.sourceOut - this.sourceIn) / this.duration;
    const offset = Math.round((sourceTime - this.sourceIn) / rate);
    return this.timelineStart + Math.min(Math.max(offset, 0), this.duration);
  }

  contains(timelineTime: Ms): boolean {
    return timelineTime >= this.timelineStart && timelineTime < this.timelineEnd;
  }

  overlaps(other: Clip): boolean {
    return this.timelineStart < other.timelineEnd && other.timelineStart < this.timelineEnd;
  }

  with(changes: Partial<ClipInit>): Clip {
    return new Clip({
      id: this.id,
      sourceId: this.sourceId,
      timelineStart: this.timelineStart,
      duration: this.duration,
      sourceIn: this.sourceIn,
      sourceOut: this.sourceOutOverride ?? undefined,
      label: this.label,
      enabled: this.enabled,
      linkGroupId: this.linkGroupId,
      transform: this.transform,
      effects: this.effects,
      ...changes,
    });
  }

  withTransform(transform: Animatable<Transform>): Clip {
    return this.with({ transform });
  }

  splitAt(timelineTime: Ms, rightId: ClipId = newClipId()): [Clip, Clip] {
    invariant(!this.effects.isFreeze, 'CANNOT_SPLIT_FREEZE', this.id);
    const at = assertNonNegativeMs(timelineTime, 'splitAt');
    invariant(
      at > this.timelineStart && at < this.timelineEnd,
      'SPLIT_OUTSIDE_CLIP',
      `${at} not inside ${this.timelineStart}..${this.timelineEnd}`,
    );
    const leftDuration = at - this.timelineStart;
    const sourceAtCut = this.sourceTimeAt(at);
    const left = this.with({ duration: leftDuration, sourceOut: sourceAtCut });
    const right = this.with({
      id: rightId,
      timelineStart: at,
      duration: this.duration - leftDuration,
      sourceIn: sourceAtCut,
      sourceOut: this.sourceOut,
    });
    return [left, right];
  }

  toJSON(): ClipJson {
    const json: ClipJson = {
      id: this.id,
      sourceId: this.sourceId,
      timelineStart: this.timelineStart,
      duration: this.duration,
      sourceIn: this.sourceIn,
    };
    if (this.sourceOutOverride !== null) json.sourceOut = this.sourceOutOverride;
    if (this.label) json.label = this.label;
    if (!this.enabled) json.enabled = false;
    if (this.linkGroupId) json.linkGroup = this.linkGroupId;
    if (this.transform.kind !== 'const' || !isIdentityTransform(evaluate(this.transform, 0))) {
      json.transform = this.transform;
    }
    if (this.effects.list.length) json.effects = this.effects.toJSON();
    return json;
  }

  static fromJSON(json: ClipJson): Clip {
    return new Clip({
      id: json.id,
      sourceId: json.sourceId,
      timelineStart: json.timelineStart,
      duration: json.duration,
      sourceIn: json.sourceIn,
      sourceOut: json.sourceOut,
      label: json.label,
      enabled: json.enabled,
      linkGroupId: json.linkGroup ?? null,
      transform: json.transform,
      effects: json.effects,
    });
  }
}
