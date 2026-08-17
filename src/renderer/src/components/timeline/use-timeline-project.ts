import { useState } from 'react';

import { Timeline } from '../../../../../lib/domain/timeline.ts';

export function useTimelineProject(): Timeline {
  const [timeline] = useState(() => new Timeline());
  return timeline;
}
