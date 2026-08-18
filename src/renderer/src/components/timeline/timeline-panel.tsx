import { visibleDuration } from '../../../../../lib/domain/timeline-interaction.ts';

import { timelineErrorMessage, type TimelineProjectState } from './use-timeline-project.ts';
import { TimelinePlayhead } from './timeline-playhead.tsx';
import { TimelineRuler } from './timeline-ruler.tsx';
import { TimelineTrackRow } from './timeline-track-row.tsx';

export function hasTimelineClips(
  state: Extract<TimelineProjectState, { status: 'ready' | 'missing-source' }>,
): boolean {
  return state.project.timeline.tracks.some((track) => track.clips.length > 0);
}

export function TimelinePanel({ state }: { state: TimelineProjectState }) {
  if (state.status === 'loading') {
    return (
      <div className="react-timeline-panel react-timeline-state" role="status" aria-live="polite">
        <strong>Loading project timeline</strong>
        <span>Loading the current take.</span>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="react-timeline-panel react-timeline-state">
        <strong>No takes found</strong>
        <span>Record a take to populate the timeline dock.</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="react-timeline-panel react-timeline-state react-timeline-state-error" role="alert">
        <strong>Timeline unavailable</strong>
        <span>{timelineErrorMessage()}</span>
      </div>
    );
  }

  const timeline = state.project.timeline;
  const duration = visibleDuration(timeline);
  const widthPx = Math.max(720, Math.ceil(duration * 0.096));
  const noClips = !hasTimelineClips(state);

  return (
    <div className="react-timeline-panel" data-state={state.status}>
      {state.status === 'missing-source' ? (
        <div className="react-timeline-banner" role="status">
          Missing source: {state.loadedProject.missingSources.join(', ')}
        </div>
      ) : null}
      {noClips ? (
        <div className="react-timeline-state">
          <strong>This take has no clips</strong>
          <span>{timeline.takeId || state.takeId}</span>
        </div>
      ) : (
        <div className="react-timeline-viewport" aria-label={`Read-only timeline for ${timeline.takeId || state.takeId}`}>
          <div className="react-timeline-content" style={{ width: `${widthPx}px` }}>
            <TimelineRuler duration={duration} />
            <div className="react-timeline-tracks">
              {timeline.tracks.map((track) => (
                <TimelineTrackRow
                  key={track.id}
                  duration={duration}
                  sources={timeline.sources}
                  track={track}
                />
              ))}
            </div>
            <TimelinePlayhead at={0} duration={duration} />
          </div>
        </div>
      )}
    </div>
  );
}
