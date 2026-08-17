import { createRoot } from 'react-dom/client';

import { lastClipEnd } from './studio.ts';

const host = document.getElementById('app-shell-root');
if (host) createRoot(host).render(<div>{lastClipEnd([])}</div>);
