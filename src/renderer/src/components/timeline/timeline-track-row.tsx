import type { SourceId } from '../../../../../lib/domain/clip.ts';
import type { Source } from '../../../../../lib/domain/source.ts';
import type { Track } from '../../../../../lib/domain/track.ts';

import { TimelineClip } from './timeline-clip.tsx';

export function TimelineTrackRow({
  duration,
  sources,
  track,
}: {
  duration: number;
  sources: Map<SourceId, Source>;
  track: Track;
}) {
  return (
    <div className="react-timeline-track-row" data-kind={track.kind}>
      <div className="react-timeline-track-label">
        <strong>{track.name}</strong>
        <span>{track.kind}</span>
      </div>
      <div className="react-timeline-track" aria-label={track.name}>
        {track.clips.map((clip) => (
          <TimelineClip
            key={clip.id}
            clip={clip}
            duration={duration}
            source={sources.get(clip.sourceId) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
