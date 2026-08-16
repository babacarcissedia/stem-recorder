import type { Animatable } from './animatable.ts';
import { invariant } from './invariant.ts';

export type EffectId = string;

export type Rect = { x: number; y: number; w: number; h: number };

export type Effect =
  | { id: EffectId; type: 'crop'; enabled: boolean; params: { rect: Animatable<Rect> } }
  | { id: EffectId; type: 'mirror'; enabled: boolean; params: Record<string, never> }
  | { id: EffectId; type: 'rotate'; enabled: boolean; params: { degrees: 90 | 180 | 270 } }
  | { id: EffectId; type: 'freeze'; enabled: boolean; params: Record<string, never> }
  | { id: EffectId; type: 'speed'; enabled: boolean; params: { rate: number } }
  | { id: EffectId; type: 'zoom'; enabled: boolean; params: { rect: Animatable<Rect> } };

const MIN_CROP_SIZE = 0.05;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export function normalizeRect(rect: unknown, minSize = MIN_CROP_SIZE): Rect | null {
  if (!rect || typeof rect !== 'object') return null;
  const raw = rect as Partial<Rect>;
  let x = Number(raw.x);
  let y = Number(raw.y);
  let w = Number(raw.w);
  let h = Number(raw.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  x = Math.min(Math.max(x, 0), 1 - minSize);
  y = Math.min(Math.max(y, 0), 1 - minSize);
  w = Math.min(Math.max(w, minSize), 1 - x);
  h = Math.min(Math.max(h, minSize), 1 - y);
  x = round4(x);
  y = round4(y);
  w = round4(w);
  h = round4(h);
  if (x === 0 && y === 0 && w === 1 && h === 1) return null;
  return { x, y, w, h };
}

export function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function normalizeSpeedRate(rate: unknown): number | null {
  if (rate == null || rate === '') return null;
  const value = Number(rate);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(Math.min(Math.max(value, 0.25), 4) * 100) / 100;
  return rounded === 1 ? null : rounded;
}

export class EffectStack {
  readonly list: Effect[];

  constructor(list: Effect[] = []) {
    const seen = new Set<EffectId>();
    for (const effect of list) {
      invariant(!seen.has(effect.id), 'DUPLICATE_EFFECT_ID', effect.id);
      seen.add(effect.id);
      if (effect.type === 'speed') {
        invariant(
          Number.isFinite(effect.params.rate) && effect.params.rate >= 0.25 && effect.params.rate <= 4,
          'SPEED_RATE_OUT_OF_RANGE',
          String(effect.params.rate),
        );
      }
    }
    this.list = list;
  }

  get enabledEffects(): Effect[] {
    return this.list.filter((effect) => effect.enabled);
  }

  has(type: Effect['type']): boolean {
    return this.enabledEffects.some((effect) => effect.type === type);
  }

  get isFreeze(): boolean {
    return this.has('freeze');
  }

  get rate(): number {
    const speed = this.enabledEffects.find((effect) => effect.type === 'speed');
    return speed && speed.type === 'speed' ? speed.params.rate : 1;
  }

  with(effect: Effect): EffectStack {
    const rest = this.list.filter((existing) => existing.id !== effect.id);
    return new EffectStack([...rest, effect]);
  }

  without(id: EffectId): EffectStack {
    return new EffectStack(this.list.filter((effect) => effect.id !== id));
  }

  signature(): string {
    return JSON.stringify(
      this.enabledEffects.map((effect) => [effect.type, effect.params]).sort((a, b) =>
        String(a[0]).localeCompare(String(b[0])),
      ),
    );
  }

  toJSON(): Effect[] {
    return this.list;
  }
}
