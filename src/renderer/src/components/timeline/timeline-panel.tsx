import { useCallback, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { Timeline } from '../../../../../lib/domain/timeline.ts';
import { Selection } from '../../../../../lib/domain/selection.ts';
import { formatTimecode } from '../../../../../lib/domain/ms.ts';
import { seekTarget, selectOnPointer, visibleDuration } from '../../../../../lib/domain/timeline-interaction.ts';
import { TimelineRuler } from './timeline-ruler.tsx';
import { TimelineTrackRow } from './timeline-track-row.tsx';
import { TimelinePlayhead } from './timeline-playhead.tsx';

export type TimelinePanelProps = {
  timeline: Timeline;
};

export function TimelinePanel({ timeline }: TimelinePanelProps) {
  const [playhead, setPlayhead] = useState(0);
  const [selection, setSelection] = useState(() => Selection.empty());

  const duration = visibleDuration(timeline);

  const seekToPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width <= 0) return;
      setPlayhead(seekTarget((event.clientX - bounds.left) / bounds.width, duration));
    },
    [duration],
  );

  const selectClip = useCallback(
    (trackId: string, clipId: string, modifiers: { shift: boolean; meta: boolean; ctrl: boolean }) => {
      setSelection((current) => selectOnPointer(timeline, current, { trackId, clipId }, modifiers));
    },
    [timeline],
  );

  const selectedCount = selection.clips.length;
  const tracks = useMemo(() => timeline.tracks, [timeline]);

  return (
    <div className="tl2-panel">
      <div className="tl2-header">
        <output className="tl2-clock" aria-label="Playhead position">
          {formatTimecode(playhead)}
        </output>
        <span className="tl2-duration">{formatTimecode(duration)}</span>
        <span className="tl2-selection-count">
          {selectedCount === 1 ? '1 clip selected' : `${selectedCount} clips selected`}
        </span>
      </div>

      <div
        className="tl2-scroller"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget || !(event.target as HTMLElement).closest('.tl2-clip')) {
            setSelection((current) => current.clearClips());
          }
          seekToPointer(event);
        }}
      >
        <TimelineRuler visibleDuration={duration} />

        <div className="tl2-lanes">
          {tracks.length === 0 ? (
            <p className="tl2-empty">No tracks yet. Record or import a take to fill the timeline.</p>
          ) : (
            tracks.map((track) => (
              <TimelineTrackRow
                key={track.id}
                track={track}
                selection={selection}
                visibleDuration={duration}
                onSelectClip={selectClip}
              />
            ))
          )}
        </div>

        <TimelinePlayhead playhead={playhead} visibleDuration={duration} />
      </div>
    </div>
  );
}
