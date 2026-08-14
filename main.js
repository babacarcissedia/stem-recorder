'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  ipcMain,
  shell,
} = require('electron');

const APP_NAME = 'Stem Recorder';
const ICON = path.join(__dirname, 'build', 'icon.png');
const OUT_ROOT = () => path.join(app.getPath('videos'), 'stem-recorder');

if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON)) {
  app.dock.setIcon(ICON);
}

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId('dev.bcd.stem-recorder');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
      if (r.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().split('\n').slice(-8).join('\n') || `ffmpeg exit ${code}`));
    });
  });
}

/**
 * MediaRecorder usually emits webm. Transcode to the public stem formats:
 *   screen/cam → .mp4 (H.264)
 *   audio      → .mp3 (LAME)
 */
async function finalizeStem(takeDir, kind, rawPath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    // Keep raw container; rename to kind.webm
    const fallback = path.join(takeDir, `${kind}${path.extname(rawPath) || '.webm'}`);
    if (rawPath !== fallback) fs.renameSync(rawPath, fallback);
    return { file: fallback, format: path.extname(fallback).slice(1), transcoded: false };
  }

  if (kind === 'audio') {
    const out = path.join(takeDir, 'audio.mp3');
    await runFfmpeg(ffmpeg, [
      '-hide_banner', '-y', '-i', rawPath,
      '-vn', '-c:a', 'libmp3lame', '-b:a', '192k',
      out,
    ]);
    fs.unlinkSync(rawPath);
    return { file: out, format: 'mp3', transcoded: true };
  }

  const out = path.join(takeDir, `${kind}.mp4`);
  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y', '-i', rawPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-an',
    '-movflags', '+faststart',
    out,
  ]);
  fs.unlinkSync(rawPath);
  return { file: out, format: 'mp4', transcoded: true };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#f6f4ef',
    icon: fs.existsSync(ICON) ? ICON : undefined,
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
  const ffmpeg = findFfmpeg();
  fs.writeFileSync(
    path.join(takeDir, 'manifest.txt'),
    [
      `stamp=${stamp}`,
      `started_at=${new Date().toISOString()}`,
      `dir=${takeDir}`,
      `ffmpeg=${ffmpeg || 'missing'}`,
      `targets=screen.mp4,cam.mp4,audio.mp3`,
      '',
    ].join('\n'),
    'utf8'
  );
  return takeDir;
});

ipcMain.handle('recorder:saveTrack', async (_evt, { takeDir, kind, ext, data }) => {
  ensureDir(takeDir);
  const rawExt = ext || 'webm';
  const rawPath = path.join(takeDir, `.raw-${kind}.${rawExt}`);
  fs.writeFileSync(rawPath, Buffer.from(data));

  try {
    const result = await finalizeStem(takeDir, kind, rawPath);
    fs.appendFileSync(
      path.join(takeDir, 'manifest.txt'),
      `${kind}=${result.file}\tformat=${result.format}\ttranscoded=${result.transcoded}\n`,
      'utf8'
    );
    return result.file;
  } catch (err) {
    // Leave raw file if transcode fails so the take is not lost
    const fallback = path.join(takeDir, `${kind}.${rawExt}`);
    if (fs.existsSync(rawPath)) fs.renameSync(rawPath, fallback);
    fs.appendFileSync(
      path.join(takeDir, 'manifest.txt'),
      `${kind}=${fallback}\terror=${String(err.message || err).replace(/\n/g, ' ')}\n`,
      'utf8'
    );
    throw err;
  }
});

ipcMain.handle('recorder:openTake', (_evt, takeDir) => {
  if (takeDir && fs.existsSync(takeDir)) shell.openPath(takeDir);
});

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelParameters({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: '© 2026 Babacar Cisse Dia',
      credits: 'Separate screen · cam · mic stems for overlay later.\nhttps://github.com/babacarcissedia/stem-recorder',
      iconPath: fs.existsSync(ICON) ? ICON : undefined,
    });
  }
  ensureDir(OUT_ROOT());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
