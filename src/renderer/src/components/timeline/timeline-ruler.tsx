import { formatTimecode } from '../../../../../lib/domain/ms.ts';
import { rulerTicks } from '../../../../../lib/domain/timeline-interaction.ts';

export function TimelineRuler({ duration }: { duration: number }) {
  const ticks = rulerTicks(duration);

  return (
    <div className="react-timeline-ruler" aria-hidden="true">
      {ticks.map((tick) => (
        <span key={tick} style={{ insetInlineStart: `${(tick / duration) * 100}%` }}>
          {formatTimecode(tick)}
        </span>
      ))}
    </div>
  );
}
