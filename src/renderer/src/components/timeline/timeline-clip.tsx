import { memo } from 'react';

import type { Clip } from '../../../../../lib/domain/clip.ts';
import type { TrackKind } from '../../../../../lib/domain/track.ts';
import { formatTimecode } from '../../../../../lib/domain/ms.ts';

export type TimelineClipProps = {
  clip: Clip;
  kind: TrackKind;
  selected: boolean;
  visibleDuration: number;
  onSelect: (clipId: string, modifiers: { shift: boolean; meta: boolean; ctrl: boolean }) => void;
};

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

export const TimelineClip = memo(function TimelineClip({
  clip,
  kind,
  selected,
  visibleDuration,
  onSelect,
}: TimelineClipProps) {
  const label = clip.label || clip.id;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`tl2-clip tl2-clip-${kind}${selected ? ' is-selected' : ''}`}
      style={{ left: percent(clip.timelineStart, visibleDuration), width: percent(clip.duration, visibleDuration) }}
      title={`${label} · ${formatTimecode(clip.timelineStart)} to ${formatTimecode(clip.timelineEnd)}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(clip.id, { shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey });
      }}
    >
      <span className="tl2-clip-label">{label}</span>
    </button>
  );
});
