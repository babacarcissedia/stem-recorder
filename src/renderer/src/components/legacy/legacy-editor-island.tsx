import { useEffect, useMemo, useRef, useState } from 'react';

type ShellCommandLifecycleView = 'studio';

type ShellCommandLifecycle = {
  mountShortcutMenuLifecycle: () => () => void;
};

type LegacyEditorWindow = Window & typeof globalThis & {
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

export function LegacyEditorIsland() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [legacyHostReady, setLegacyHostReady] = useState(false);
  const legacyStudioLifecycle = useMemo<ShellCommandLifecycle>(() => ({
    mountShortcutMenuLifecycle: () => {
      const legacyStudioWindow = window as LegacyEditorWindow;

      return legacyStudioWindow.mountLegacyStudio();
    },
  }), []);

  useEffect(() => {
    const legacyStudioRoot = document.getElementById('legacy-studio-root');
    const host = hostRef.current;

    if (!legacyStudioRoot || !host) throw new Error('Missing LegacyEditorIsland markup');

    const parkedParent = legacyStudioRoot.parentElement ?? document.body;
    const parkedBefore = legacyStudioRoot.nextSibling;

    host.append(legacyStudioRoot);
    const legacyStudioWindow = window as LegacyEditorWindow;
    legacyStudioWindow.mountRecorderPanel();
    setLegacyHostReady(true);

    return () => {
      setLegacyHostReady(false);
      parkedParent.insertBefore(legacyStudioRoot, parkedBefore?.parentNode === parkedParent ? parkedBefore : null);
    };
  }, []);

  useShellCommandLifecycle('studio', legacyHostReady ? legacyStudioLifecycle : null);

  return <div ref={hostRef} className="legacy-studio-host" role="region" aria-label="Studio editor" />;
}
