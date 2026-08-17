import { memo } from 'react';

import type { Track } from '../../../../../lib/domain/track.ts';
import type { Selection } from '../../../../../lib/domain/selection.ts';
import { TimelineClip } from './timeline-clip.tsx';

export type TimelineTrackRowProps = {
  track: Track;
  selection: Selection;
  visibleDuration: number;
  onSelectClip: (
    trackId: string,
    clipId: string,
    modifiers: { shift: boolean; meta: boolean; ctrl: boolean },
  ) => void;
};

export const TimelineTrackRow = memo(function TimelineTrackRow({
  track,
  selection,
  visibleDuration,
  onSelectClip,
}: TimelineTrackRowProps) {
  const selectedHere = selection.onTrack(track.id);

  return (
    <div className={`tl2-lane tl2-lane-${track.kind}`} data-track-id={track.id}>
      <span className="tl2-lane-name">{track.name}</span>
      <div
        className="tl2-lane-clips"
        role="listbox"
        aria-multiselectable
        aria-label={`${track.name} clips, ${selectedHere.length} selected`}
      >
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            kind={track.kind}
            selected={selection.has({ trackId: track.id, clipId: clip.id })}
            visibleDuration={visibleDuration}
            onSelect={(clipId, modifiers) => onSelectClip(track.id, clipId, modifiers)}
          />
        ))}
      </div>
    </div>
  );
});
