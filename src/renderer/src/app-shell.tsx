import { useState } from 'react';

import { LegacyEditorIsland } from './components/legacy/legacy-editor-island.tsx';
import { ShellLayout } from './components/layout/shell-layout.tsx';
import { PlayerPanel } from './components/player/player-panel.tsx';
import { InspectorSidebar } from './components/sidebar/inspector-sidebar.tsx';
import { MediaSidebar } from './components/sidebar/media-sidebar.tsx';
import { TimelineFooter } from './components/timeline/timeline-footer.tsx';
import { TopBar } from './components/top-bar/top-bar.tsx';

const SHELL_VIEWS = ['studio', 'record', 'library'] as const;
const DEFAULT_SHELL_VIEW: ShellView = 'studio';

export type ShellView = (typeof SHELL_VIEWS)[number];

function StudioEditorChrome() {
  return (
    <section className="studio-editor-chrome" aria-labelledby="studio-editor-title">
      <header className="studio-editor-header">
        <div className="studio-editor-heading">
          <p className="studio-editor-kicker">Workspace</p>
          <h1 id="studio-editor-title" className="studio-editor-title">Studio</h1>
          <p className="studio-editor-copy">Record, edit, and export your current take in one workspace.</p>
        </div>
        <div className="studio-editor-status" role="status" aria-label="Studio status">
          Ready
        </div>
      </header>
      <section className="studio-editor-react-shell" role="region" aria-label="Studio preview">
        <TopBar projectName="Current take" autoSavedAt={null} />
        <ShellLayout
          leftSidebar={<MediaSidebar />}
          main={<PlayerPanel />}
          rightSidebar={<InspectorSidebar />}
          footer={<TimelineFooter />}
        />
      </section>
      <div className="studio-editor-compatibility-frame" role="region" aria-label="Studio editor">
        <LegacyEditorIsland />
      </div>
    </section>
  );
}

function RecordShell() {
  return (
    <section className="shell-surface shell-surface-record" aria-labelledby="record-shell-title">
      <div className="shell-surface-kicker">Coming soon</div>
      <h1 id="record-shell-title" className="shell-surface-title">Record</h1>
      <p className="shell-surface-copy">Capture controls will move here. Studio keeps the current recorder available.</p>
      <div className="shell-surface-panel" role="region" aria-label="Record setup">
        <h2 className="shell-surface-panel-title">Setup</h2>
        <p className="shell-surface-panel-copy">Screen, camera, and microphone setup will stay in Studio until this workspace is ready.</p>
      </div>
    </section>
  );
}

function LibraryShell() {
  return (
    <section className="shell-surface shell-surface-library" aria-labelledby="library-shell-title">
      <div className="shell-surface-kicker">Coming soon</div>
      <h1 id="library-shell-title" className="shell-surface-title">Library</h1>
      <p className="shell-surface-copy">Recent takes and project organization will land here. Studio stays available.</p>
      <div className="shell-surface-panel" role="region" aria-label="Library contents">
        <h2 className="shell-surface-panel-title">Takes</h2>
        <p className="shell-surface-panel-copy">Open Studio to use the current take picker until this workspace is ready.</p>
      </div>
    </section>
  );
}

function routeLabel(view: ShellView) {
  switch (view) {
    case 'studio':
      return 'Studio workspace';
    case 'record':
      return 'Record workspace';
    case 'library':
      return 'Library workspace';
  }
}

function renderShellView(view: ShellView) {
  switch (view) {
    case 'studio':
      return <StudioEditorChrome />;
    case 'record':
      return <RecordShell />;
    case 'library':
      return <LibraryShell />;
  }
}

export function AppShell() {
  const [shellView, setShellView] = useState<ShellView>(DEFAULT_SHELL_VIEW);

  return (
    <div className="shell-root" data-shell-view={shellView} aria-label="Stem Studio">
      <nav className="shell-route-nav" aria-label="Workspaces">
        {SHELL_VIEWS.map((view) => (
          <button
            key={view}
            type="button"
            className={`shell-route-tab${shellView === view ? ' active' : ''}`}
            aria-pressed={shellView === view}
            aria-label={`Show ${routeLabel(view)}`}
            onClick={() => setShellView(view)}
          >
            {routeLabel(view).replace(' workspace', '')}
          </button>
        ))}
      </nav>
      <main className="shell-route" data-shell-route={shellView} aria-label={routeLabel(shellView)}>
        {renderShellView(shellView)}
      </main>
    </div>
  );
}
