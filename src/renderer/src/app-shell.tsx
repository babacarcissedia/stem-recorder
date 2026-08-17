import { useEffect, useRef } from 'react';

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

export function AppShell() {
  return (
    <div className="shell-root">
      <LegacyStudioHost />
    </div>
  );
}
