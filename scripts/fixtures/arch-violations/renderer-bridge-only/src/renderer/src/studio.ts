import { probeDuration } from '../../../lib/node/ffmpeg-util.js';
import { clipEnd } from '../../../lib/domain/clip-ops.ts';

export function lastClipEnd(clips: Array<{ out: number }>): number {
  probeDuration('screen.mp4');
  return clips.length ? clipEnd(clips[clips.length - 1]) : 0;
}
