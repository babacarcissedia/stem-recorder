import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';

import { probeDuration } from '../../lib/node/ffmpeg-util.js';
import { clipEnd } from '../../lib/domain/clip-ops.ts';
import { contentSecurityPolicy } from './csp.ts';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: true,
      sandbox: true,
      // nodeIntegration: false,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy(false)],
      },
    });
  });

  return win;
}

export const identity = { app, probeDuration, clipEnd };
