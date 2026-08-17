import { createRoot } from 'react-dom/client';
import './fonts.css';
import './tokens.css';
import './affordance.css';
import './timeline.css';
import './app-shell.css';
import { AppShell } from './app-shell.tsx';
import './recorder-panel.ts';
import './studio.ts';
import { startThemeSync } from './theme/apply-theme.ts';

const host = document.getElementById('app-shell-root');

if (!host) throw new Error('Missing AppShell root');

startThemeSync();
createRoot(host).render(<AppShell />);
