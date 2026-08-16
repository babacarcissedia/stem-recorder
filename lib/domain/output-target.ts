import type { Animatable } from './animatable.ts';
import { constant } from './animatable.ts';
import type { Rect } from './effects.ts';
import { invariant } from './invariant.ts';

export type OutputId = string;

export const FULL_FRAME: Rect = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export type OutputTarget = {
  id: OutputId;
  name: string;
  aspect: string;
  width: number;
  height: number;
  framing: Animatable<Rect>;
  enabled: boolean;
  captionStyleId?: string;
};

export function makeOutputTarget(
  init: Partial<OutputTarget> & Pick<OutputTarget, 'id' | 'width' | 'height'>,
): OutputTarget {
  invariant(typeof init.id === 'string' && init.id.length > 0, 'OUTPUT_ID_REQUIRED');
  invariant(
    Number.isInteger(init.width) && init.width > 0,
    'OUTPUT_WIDTH_INVALID',
    String(init.width),
  );
  invariant(
    Number.isInteger(init.height) && init.height > 0,
    'OUTPUT_HEIGHT_INVALID',
    String(init.height),
  );
  return {
    id: init.id,
    name: init.name ?? init.id,
    aspect: init.aspect ?? aspectOf(init.width, init.height),
    width: init.width,
    height: init.height,
    framing: init.framing ?? constant(FULL_FRAME),
    enabled: init.enabled ?? true,
    ...(init.captionStyleId ? { captionStyleId: init.captionStyleId } : {}),
  };
}

function aspectOf(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}
