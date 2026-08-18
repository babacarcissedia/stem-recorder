import type { Clip } from '../../../../../lib/domain/clip.ts';
import type { Source } from '../../../../../lib/domain/source.ts';

function clipLabel(clip: Clip, source: Source | null): string {
  return clip.label || source?.label || source?.path || clip.id;
}

export function TimelineClip({
  clip,
  duration,
  source,
}: {
  clip: Clip;
  duration: number;
  source: Source | null;
}) {
  const left = duration > 0 ? (clip.timelineStart / duration) * 100 : 0;
  const width = duration > 0 ? (clip.duration / duration) * 100 : 0;

  return (
    <div
      className="react-timeline-clip"
      data-kind={source?.kind ?? 'video'}
      data-present={source?.present === false ? 'false' : 'true'}
      style={{
        insetInlineStart: `${left}%`,
        width: `${width}%`,
      }}
      title={clipLabel(clip, source)}
    >
      <span>{clipLabel(clip, source)}</span>
    </div>
  );
}
