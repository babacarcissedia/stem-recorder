'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  dialog,
  session,
  desktopCapturer,
  ipcMain,
  shell,
} = require('electron');

const { outRoot } = require('./lib/node/paths.js');
const {
  findFfmpeg, runFfmpeg, applyClips, hasSubtitlesFilter, resolveCaptionsPath,
} = require('./lib/node/ffmpeg-util.js');
const {
  listTakes,
  readManifest,
  writeManifest,
  mediaUrls,
  takeDirFor,
  FINAL_NAME,
  PRE_BURN_FINAL_NAME,
} = require('./lib/node/edit-manifest.js');
const { getFilmstrip, getWaveformPeaks } = require('./lib/node/media-cache.js');
const {
  runLocal: runLocalAsr,
  runCloud: runCloudAsr,
  readTranscript,
  asrStatus,
  resolveBurn,
  updateCueText,
} = require('./lib/node/transcribe.js');
const { planExportBundle } = require('./lib/domain/export-bundle.ts');

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
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k',
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
  const preBurnOut = path.join(takeDir, PRE_BURN_FINAL_NAME);
  const work = path.join(editDir, '.work');
  if (fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true });
  ensureDir(work);

  // Edit-T2a: cam PiP is on by default whenever the take has a cam stem;
  // cam.pip === false is the stored opt-out. No PiP when the cam itself is
  // the primary source.
  const camPath = path.join(takeDir, 'cam.mp4');
  const camSettings = manifest.cam || {};
  const pip = sourceName !== 'cam.mp4'
    && fs.existsSync(camPath)
    && camSettings.pip !== false;

  let burn = resolveBurn(takeDir, manifest);
  if (burn.burn) {
    const ffmpeg = findFfmpeg();
    if (ffmpeg && !hasSubtitlesFilter(ffmpeg)) {
      burn = {
        burn: false,
        requested: true,
        skipped: 'this ffmpeg build lacks the subtitles filter (libass) — install a full ffmpeg or set FFMPEG_PATH',
      };
    }
  }
  const captionStyle = manifest.captions && manifest.captions.style === 'karaoke' ? 'karaoke' : 'segment';
  const karaokeRequested = burn.burn && captionStyle === 'karaoke';
  const subtitlesPath = burn.burn
    ? (karaokeRequested ? resolveCaptionsPath(editDir, {}) : burn.vtt)
    : null;

  const rate = manifest.exportRate || null;
  let music = manifest.music || null;
  let musicSkipped = null;
  if (music && !fs.existsSync(music.path)) {
    musicSkipped = `music file missing: ${music.path}`;
    music = null;
  }

  const verticalRequested = manifest.vertical === true;
  const vertical = verticalRequested ? {} : null;

  try {
    await applyClips(src, manifest.clips, out, work, {
      ...(pip ? {
        cam: {
          path: camPath,
          mirror: Boolean(camSettings.mirror),
          rotate: camSettings.rotate || 0,
          layout: camSettings.pipLayout || null,
        },
      } : {}),
      ...(burn.burn ? { subtitles: subtitlesPath, preBurnOutPath: preBurnOut } : {}),
      ...(rate ? { rate } : {}),
      ...(music ? { music } : {}),
      ...(vertical ? { vertical } : {}),
    });
    if (!burn.burn) fs.rmSync(preBurnOut, { force: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  return {
    final: out,
    url: pathToFileURL(out).href,
    clips: manifest.clips.length,
    freeze: manifest.clips.filter((c) => c.freeze).length,
    pip,
    captions: burn.burn,
    captionStyle: burn.burn ? captionStyle : null,
    captionsSkipped: burn.skipped || null,
    preBurnFinal: burn.burn ? preBurnOut : null,
    rate: rate || 1,
    music: Boolean(music),
    musicSkipped,
    vertical: Boolean(vertical),
  };
});

ipcMain.handle('studio:chooseMusic', async (evt) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose music bed',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('studio:openTakeFolder', (_evt, takeId) => {
  const takeDir = takeDirFor(takeId);
  shell.openPath(takeDir);
});

ipcMain.handle('studio:revealStem', (_evt, takeId, stemFile) => {
  if (!['screen.mp4', 'cam.mp4', 'audio.mp3'].includes(stemFile)) throw new Error(`invalid stem ${stemFile}`);
  const stemPath = path.join(takeDirFor(takeId), stemFile);
  if (!fs.existsSync(stemPath)) throw new Error(`missing stem ${stemFile}`);
  shell.showItemInFolder(stemPath);
});

ipcMain.handle('studio:ffmpegOk', () => Boolean(findFfmpeg()));

ipcMain.handle('studio:getFilmstrip', (_evt, takeId, stemFile) => {
  if (!['screen.mp4', 'cam.mp4'].includes(stemFile)) throw new Error(`invalid stem ${stemFile}`);
  return getFilmstrip(takeDirFor(takeId), stemFile);
});

ipcMain.handle('studio:getWaveform', (_evt, takeId) => getWaveformPeaks(takeDirFor(takeId)));

ipcMain.handle('studio:transcribe', async (_evt, { takeId, provider } = {}) => {
  const takeDir = takeDirFor(takeId);
  // Explicit provider choice only — no silent local→cloud fallback.
  if (provider === 'cloud') return runCloudAsr({ takeDir });
  return runLocalAsr({ takeDir });
});

ipcMain.handle('studio:getTranscript', (_evt, takeId) => readTranscript(takeDirFor(takeId)));

ipcMain.handle('studio:setCueText', (_evt, takeId, index, text) => {
  if (typeof text !== 'string') throw new Error('cue text must be a string');
  return updateCueText(takeDirFor(takeId), index, text);
});

ipcMain.handle('studio:asrStatus', () => asrStatus());

ipcMain.handle('studio:exportBundle', async (evt, takeId) => {
  const takeDir = takeDirFor(takeId);
  const editDir = path.join(takeDir, 'edit');

  const win = BrowserWindow.fromWebContents(evt.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a folder for the export bundle',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const destDir = res.filePaths[0];

  const takeFiles = fs.readdirSync(takeDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const editFiles = fs.existsSync(editDir)
    ? fs.readdirSync(editDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
    : [];

  const { items, missing } = planExportBundle({ takeFiles, editFiles, takeId });

  ensureDir(destDir);
  for (const item of items) {
    fs.copyFileSync(path.join(takeDir, item.source), path.join(destDir, item.destName));
  }

  shell.openPath(destDir);

  return { destDir, items, missing };
});

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
