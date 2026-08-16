export function clipEnd(clip: { out: number }): number {
  return Number(clip.out) || 0;
}
