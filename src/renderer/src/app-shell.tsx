import { useEffect, useMemo, useRef, useState } from 'react';

const SHELL_VIEWS = ['studio'] as const;
const DEFAULT_SHELL_VIEW: ShellView = 'studio';

export type ShellView = (typeof SHELL_VIEWS)[number];

type ShellCommandLifecycleView = 'studio';

type ShellCommandLifecycle = {
  mountShortcutMenuLifecycle: () => () => void;
};

type LegacyStudioWindow = Window & typeof globalThis & {
  mountLegacyStudio: () => () => void;
  mountRecorderPanel: () => void;
};

function useShellCommandLifecycle(
  view: ShellCommandLifecycleView,
  lifecycle: ShellCommandLifecycle | null,
): void {
  useEffect(() => {
    if (view !== 'studio' || !lifecycle) return undefined;

    return lifecycle.mountShortcutMenuLifecycle();
  }, [view, lifecycle]);
}

function LegacyStudioHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [legacyHostReady, setLegacyHostReady] = useState(false);
  const legacyStudioLifecycle = useMemo<ShellCommandLifecycle>(() => ({
    mountShortcutMenuLifecycle: () => {
      const legacyStudioWindow = window as LegacyStudioWindow;

      return legacyStudioWindow.mountLegacyStudio();
    },
  }), []);

  useEffect(() => {
    const legacyStudioRoot = document.getElementById('legacy-studio-root');
    const host = hostRef.current;

    if (!legacyStudioRoot || !host) throw new Error('Missing LegacyStudioHost markup');

    const parkedParent = legacyStudioRoot.parentElement ?? document.body;
    const parkedBefore = legacyStudioRoot.nextSibling;

    host.append(legacyStudioRoot);
    const legacyStudioWindow = window as LegacyStudioWindow;
    legacyStudioWindow.mountRecorderPanel();
    setLegacyHostReady(true);

    return () => {
      setLegacyHostReady(false);
      parkedParent.insertBefore(legacyStudioRoot, parkedBefore?.parentNode === parkedParent ? parkedBefore : null);
    };
  }, []);

  useShellCommandLifecycle('studio', legacyHostReady ? legacyStudioLifecycle : null);

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
