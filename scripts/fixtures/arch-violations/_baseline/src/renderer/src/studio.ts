import { clipEnd } from '../../../lib/domain/clip-ops.ts';

export function lastClipEnd(clips: Array<{ out: number }>): number {
  return clips.length ? clipEnd(clips[clips.length - 1]) : 0;
}
