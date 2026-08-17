import { useEffect, useState } from 'react';

import { Project } from '../../../../../lib/domain/project.ts';
import { Timeline } from '../../../../../lib/domain/timeline.ts';

async function resolveTakeId(takeId?: string): Promise<string | null> {
  if (takeId) return takeId;
  const takes = (await window.stemStudio?.listTakes()) ?? [];
  const newest = takes.find((take) => take.hasScreen || take.hasCam) ?? takes[0];
  return newest ? newest.id : null;
}

export function useTimelineProject(takeId?: string): Timeline {
  const [timeline, setTimeline] = useState(() => new Timeline());

  useEffect(() => {
    const studio = window.stemStudio;
    if (!studio) return;

    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolveTakeId(takeId);
        if (cancelled || !resolved) return;
        const loaded = await studio.loadProject(resolved);
        if (cancelled) return;
        setTimeline(Project.fromJSON(loaded.project).timeline);
      } catch (error) {
        if (!cancelled) console.error('timeline: could not load take', takeId ?? '(newest)', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [takeId]);

  return timeline;
}
