import { invariant } from './invariant.ts';

export type Transform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export const IDENTITY_TRANSFORM: Transform = Object.freeze({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
});

const round4 = (value: number) => Math.round(value * 10000) / 10000;

export function makeTransform(partial: Partial<Transform> = {}): Transform {
  const merged = { ...IDENTITY_TRANSFORM, ...partial };
  for (const field of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
    invariant(Number.isFinite(merged[field]), 'TRANSFORM_NOT_FINITE', field);
  }
  invariant(merged.scale > 0, 'TRANSFORM_SCALE_NOT_POSITIVE', String(merged.scale));
  invariant(
    merged.opacity >= 0 && merged.opacity <= 1,
    'TRANSFORM_OPACITY_OUT_OF_RANGE',
    String(merged.opacity),
  );
  const rotation = ((merged.rotation % 360) + 360) % 360;
  return {
    x: round4(merged.x),
    y: round4(merged.y),
    scale: round4(merged.scale),
    rotation: round4(rotation),
    opacity: round4(merged.opacity),
  };
}

export function isIdentityTransform(transform: Transform): boolean {
  return (
    transform.x === 0 &&
    transform.y === 0 &&
    transform.scale === 1 &&
    transform.rotation === 0 &&
    transform.opacity === 1
  );
}
