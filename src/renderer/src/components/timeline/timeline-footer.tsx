import { TimelinePanel } from './timeline-panel.tsx';
import { useTimelineProject } from './use-timeline-project.ts';

export function TimelineFooter() {
  const timeline = useTimelineProject();

  return (
    <footer className="shell-footer" aria-label="Timeline">
      <TimelinePanel timeline={timeline} />
    </footer>
  );
}
