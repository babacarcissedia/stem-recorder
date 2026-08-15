'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  ipcMain,
  shell,
} = require('electron');

const { outRoot } = require('./lib/paths');
const { findFfmpeg, runFfmpeg, applyClips } = require('./lib/ffmpeg-util');
const {
  listTakes,
  readManifest,
  writeManifest,
  mediaUrls,
  takeDirFor,
  FINAL_NAME,
} = require('./lib/edit-manifest');

const APP_NAME = 'Stem Studio';
const ICON = path.join(__dirname, 'build', 'icon.png');

if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON)) {
  app.dock.setIcon(ICON);
}

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId('dev.bcd.stem-studio');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * MediaRecorder usually emits webm. Transcode to the public stem formats:
 *   screen/cam → .mp4 (H.264)
 *   audio      → .mp3 (LAME)
 */
async function finalizeStem(takeDir, kind, rawPath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
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
    width: 1320,
    height: 900,
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

/* —— Record IPC (unchanged contract) —— */
ipcMain.handle('recorder:outRoot', () => outRoot());

ipcMain.handle('recorder:beginTake', (_evt, stamp) => {
  const takeDir = path.join(outRoot(), `take-${stamp}`);
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

/* —— Studio / Edit-T1 IPC —— */
ipcMain.handle('studio:listTakes', () => listTakes());

ipcMain.handle('studio:getTake', (_evt, takeId) => {
  const { takeDir, duration, manifest } = readManifest(takeId);
  const media = mediaUrls(takeId);
  return { takeId, takeDir, duration, manifest, urls: media.urls };
});

ipcMain.handle('studio:saveManifest', (_evt, takeId, doc) => writeManifest(takeId, doc));

ipcMain.handle('studio:apply', async (_evt, takeId) => {
  const { takeDir, manifest } = readManifest(takeId);
  const sourceName = manifest.source || 'screen.mp4';
  const src = path.join(takeDir, sourceName);
  if (!fs.existsSync(src)) throw new Error(`missing source ${sourceName}`);

  const editDir = path.join(takeDir, 'edit');
  ensureDir(editDir);
  const out = path.join(takeDir, FINAL_NAME);
  const work = path.join(editDir, '.work');
  if (fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true });
  ensureDir(work);

  try {
    await applyClips(src, manifest.clips, out, work);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  return {
    final: out,
    url: pathToFileURL(out).href,
    clips: manifest.clips.length,
  };
});

ipcMain.handle('studio:openTakeFolder', (_evt, takeId) => {
  const takeDir = takeDirFor(takeId);
  shell.openPath(takeDir);
});

ipcMain.handle('studio:ffmpegOk', () => Boolean(findFfmpeg()));

app.whenReady().then(() => {
  if (process.platform === 'darwin' && typeof app.setAboutPanelParameters === 'function') {
    app.setAboutPanelParameters({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: '© 2026 Babacar Cisse Dia',
      credits: 'Record + edit stems locally.\nhttps://github.com/babacarcissedia/stem-recorder',
      iconPath: fs.existsSync(ICON) ? ICON : undefined,
    });
  }
  ensureDir(outRoot());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
