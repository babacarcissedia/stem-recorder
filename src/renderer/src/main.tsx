import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './timeline.css';
import { AppShell } from './app-shell.tsx';
import './recorder-panel.ts';
import './studio.ts';

const shellHost = document.getElementById('app-shell-root');
if (shellHost) {
  createRoot(shellHost).render(
    <StrictMode>
      <AppShell />
    </StrictMode>
  );
}
