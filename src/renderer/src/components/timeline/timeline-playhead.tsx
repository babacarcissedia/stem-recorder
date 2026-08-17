import { memo } from 'react';

export type TimelinePlayheadProps = {
  playhead: number;
  visibleDuration: number;
};

export const TimelinePlayhead = memo(function TimelinePlayhead({
  playhead,
  visibleDuration,
}: TimelinePlayheadProps) {
  return (
    <div
      className="tl2-playhead"
      style={{ left: `${(playhead / visibleDuration) * 100}%` }}
      aria-hidden
    >
      <span className="tl2-playhead-cap" />
    </div>
  );
});
