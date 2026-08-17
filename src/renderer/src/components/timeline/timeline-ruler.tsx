import { memo } from 'react';

import { formatTimecode } from '../../../../../lib/domain/ms.ts';
import { rulerTicks } from '../../../../../lib/domain/timeline-interaction.ts';

export type TimelineRulerProps = {
  visibleDuration: number;
};

export const TimelineRuler = memo(function TimelineRuler({ visibleDuration }: TimelineRulerProps) {
  return (
    <div className="tl2-ruler" aria-hidden>
      {rulerTicks(visibleDuration).map((tick) => (
        <span
          key={tick}
          className="tl2-tick"
          style={{ left: `${(tick / visibleDuration) * 100}%` }}
        >
          {formatTimecode(tick)}
        </span>
      ))}
    </div>
  );
});
