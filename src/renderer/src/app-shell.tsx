import { useEffect, useRef, useState } from 'react';

const SHELL_VIEWS = ['studio'] as const;
const DEFAULT_SHELL_VIEW: ShellView = 'studio';

export type ShellView = (typeof SHELL_VIEWS)[number];

type LegacyStudioWindow = Window & typeof globalThis & {
  mountLegacyStudio: () => void;
  mountRecorderPanel: () => void;
};

function LegacyStudioHost() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const legacyStudioRoot = document.getElementById('legacy-studio-root');
    const host = hostRef.current;

    if (!legacyStudioRoot || !host) throw new Error('Missing LegacyStudioHost markup');

    host.append(legacyStudioRoot);
    const legacyStudioWindow = window as LegacyStudioWindow;
    legacyStudioWindow.mountRecorderPanel();
    legacyStudioWindow.mountLegacyStudio();
  }, []);

  return <div ref={hostRef} className="legacy-studio-host" />;
}

function renderShellView(view: ShellView) {
  switch (view) {
    case 'studio':
      return <LegacyStudioHost />;
  }
}

export function AppShell() {
  const [shellView] = useState<ShellView>(DEFAULT_SHELL_VIEW);

  return (
    <div className="shell-root" data-shell-view={shellView}>
      {renderShellView(shellView)}
    </div>
  );
}
