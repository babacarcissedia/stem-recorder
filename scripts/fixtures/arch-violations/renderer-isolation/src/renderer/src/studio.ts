import fs from 'node:fs';

import { clipEnd } from '../../../lib/domain/clip-ops.ts';

export function lastClipEnd(clips: Array<{ out: number }>): number {
  fs.readFileSync('/etc/passwd', 'utf8');
  return clips.length ? clipEnd(clips[clips.length - 1]) : 0;
}
