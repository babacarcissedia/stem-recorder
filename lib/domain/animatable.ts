import type { Ms } from './ms.ts';
import { assertNonNegativeMs } from './ms.ts';
import { invariant } from './invariant.ts';

export type EaseKind = 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut';

export type Keyframe<T> = { at: Ms; value: T; ease: EaseKind };

export type Animatable<T> =
  | { kind: 'const'; value: T }
  | { kind: 'keyed'; keys: Keyframe<T>[] };

export function constant<T>(value: T): Animatable<T> {
  return { kind: 'const', value };
}

export function keyed<T>(keys: Keyframe<T>[]): Animatable<T> {
  invariant(keys.length > 0, 'ANIMATABLE_EMPTY_KEYS');
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  for (const key of sorted) assertNonNegativeMs(key.at, 'keyframe.at');
  return { kind: 'keyed', keys: sorted };
}

export function evaluate<T>(animatable: Animatable<T>, at: Ms): T {
  if (animatable.kind === 'const') return animatable.value;
  const keys = animatable.keys;
  invariant(keys.length > 0, 'ANIMATABLE_EMPTY_KEYS');
  let active = keys[0]!;
  for (const key of keys) {
    if (key.at <= at) active = key;
    else break;
  }
  return active.value;
}
