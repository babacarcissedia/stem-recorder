import fs from 'node:fs';

export function clipEnd(clip: { out: number }): number {
  fs.writeFileSync('/tmp/clip-end.log', String(clip.out));
  return Number(clip.out) || 0;
}
