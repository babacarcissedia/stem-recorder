import { TopBar } from './components/top-bar/top-bar.tsx';
import { ShellLayout } from './components/layout/shell-layout.tsx';
import { MediaSidebar } from './components/sidebar/media-sidebar.tsx';
import { InspectorSidebar } from './components/sidebar/inspector-sidebar.tsx';
import { PlayerPanel } from './components/player/player-panel.tsx';
import { TimelineFooter } from './components/timeline/timeline-footer.tsx';

export function AppShell() {
  return (
    <div className="shell-root">
      <TopBar projectName="Stem Studio" autoSavedAt={null} />
      <ShellLayout
        leftSidebar={<MediaSidebar />}
        main={<PlayerPanel />}
        rightSidebar={<InspectorSidebar />}
        footer={<TimelineFooter />}
      />
    </div>
  );
}
