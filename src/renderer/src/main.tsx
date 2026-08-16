import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './fonts.css';
import './tokens.css';
import './affordance.css';
import './timeline.css';
import './app-shell.css';
import { AppShell } from './app-shell.tsx';
import { startThemeSync } from './theme/apply-theme.ts';
import './recorder-panel.ts';
import './studio.ts';

startThemeSync();

const shellHost = document.getElementById('app-shell-root');
if (shellHost) {
  createRoot(shellHost).render(
    <StrictMode>
      <AppShell />
    </StrictMode>
  );
}
