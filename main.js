'use strict';

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  ipcMain,
  shell,
} = require('electron');

const OUT_ROOT = () => path.join(app.getPath('videos'), 'batch-recorder');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Batch recorder',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'mediaKeySystem', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'display-capture'].includes(permission)
  );

  if (typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const screen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        if (!screen) {
          callback({});
          return;
        }
        callback({ video: screen });
      } catch (err) {
        console.error(err);
        callback({});
      }
    }, { useSystemPicker: true });
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('recorder:outRoot', () => OUT_ROOT());

ipcMain.handle('recorder:beginTake', (_evt, stamp) => {
  const takeDir = path.join(OUT_ROOT(), `take-${stamp}`);
  ensureDir(takeDir);
  fs.writeFileSync(
    path.join(takeDir, 'manifest.txt'),
    [
      `stamp=${stamp}`,
      `started_at=${new Date().toISOString()}`,
      `dir=${takeDir}`,
      '',
    ].join('\n'),
    'utf8'
  );
  return takeDir;
});

ipcMain.handle('recorder:saveTrack', async (_evt, { takeDir, kind, ext, data }) => {
  ensureDir(takeDir);
  const file = path.join(takeDir, `${kind}.${ext}`);
  const buf = Buffer.from(data);
  fs.writeFileSync(file, buf);
  fs.appendFileSync(
    path.join(takeDir, 'manifest.txt'),
    `${kind}=${file}\tsize=${buf.length}\n`,
    'utf8'
  );
  return file;
});

ipcMain.handle('recorder:openTake', (_evt, takeDir) => {
  if (takeDir && fs.existsSync(takeDir)) shell.openPath(takeDir);
});

app.whenReady().then(() => {
  ensureDir(OUT_ROOT());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
