import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  session,
  desktopCapturer,
  ipcMain,
  shell,
} from 'electron';

import { outRoot } from '../../lib/node/paths.js';
import {
  findFfmpeg, runFfmpeg, applyClips, hasSubtitlesFilter, probeDuration, resolveCaptionsPath,
} from '../../lib/node/ffmpeg-util.js';
import {
  listTakes,
  defaultManifest,
  normalizeManifest,
  mediaUrls,
  takeDirFor,
  FINAL_NAME,
  PRE_BURN_FINAL_NAME,
} from '../../lib/node/edit-manifest.js';
import {
  autosaveIsNewer,
  readManifestDoc,
  writeManifestDoc,
} from '../../lib/node/manifest-store.js';
import { V1_STEMS, migrateV1ToV2, toV1Compat } from '../../lib/domain/manifest-v2.ts';
import { getFilmstrip, getWaveformPeaks } from '../../lib/node/media-cache.js';
import {
  runLocal as runLocalAsr,
  runCloud as runCloudAsr,
  readTranscript,
  asrStatus,
  resolveBurn,
  updateCueText,
} from '../../lib/node/transcribe.js';
import { planExportBundle } from '../../lib/domain/export-bundle.ts';
import { toMediaUrl, MEDIA_SCHEME, BUNDLE_HOST } from '../../lib/node/media-url.js';
import { registerAppScheme, handleAppScheme } from './protocol.ts';
import { contentSecurityPolicy } from './csp.ts';
import { installAppMenu } from './menu.ts';
import { initTheme, setThemePreference, themeState } from './theme.ts';
import { isThemePreference } from '../../lib/domain/theme.ts';

const APP_NAME = 'Stem Studio';
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
const IS_DEVELOPMENT = Boolean(DEV_RENDERER_URL);
const BUNDLE_DIR = path.join(__dirname, '../renderer');
const APP_ROOT = app.getAppPath();
const ICON = path.join(APP_ROOT, 'build', 'icon.png');
let editorCommandsEnabled = false;

process.env.STEM_APP_ROOT = APP_ROOT;

registerAppScheme();

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

function stemDurations(takeDir) {
  return Object.fromEntries(V1_STEMS.map(({ file }) => [
    file,
    fs.existsSync(path.join(takeDir, file)) ? probeDuration(path.join(takeDir, file)) : null,
  ]));
}

function readStudioManifest(takeId) {
  const takeDir = takeDirFor(takeId);
  const durations = stemDurations(takeDir);
  const duration = durations['screen.mp4'] ?? null;
  const autosaveNewer = autosaveIsNewer(takeDir);
  const result = readManifestDoc(takeDir, durations);
  return {
    takeDir,
    duration,
    manifest: result.doc ? toV1Compat(result.doc) : defaultManifest(takeId, duration),
    autosaveNewer,
  };
}

function saveStudioManifest(takeId, doc) {
  const takeDir = takeDirFor(takeId);
  const durations = stemDurations(takeDir);
  const manifest = normalizeManifest(
    { ...doc, updatedAt: new Date().toISOString() },
    takeId,
    durations['screen.mp4'] ?? null,
  );
  const v2 = migrateV1ToV2(manifest, durations);
  const path = writeManifestDoc(takeDir, v2);
  return { path, manifest: toV1Compat(v2) };
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
      preload: path.join(__dirname, '../preload/index.js'),
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

  if (DEV_RENDERER_URL) {
    win.loadURL(DEV_RENDERER_URL);
  } else {
    win.loadURL(`${MEDIA_SCHEME}://${BUNDLE_HOST}/index.html`);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.on('menu:set-editor-commands-enabled', (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean' || enabled === editorCommandsEnabled) return;
  editorCommandsEnabled = enabled;
  installAppMenu(APP_NAME, editorCommandsEnabled);
});

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
ipcMain.handle('theme:get', () => themeState());
ipcMain.handle('theme:set', (_evt, preference) => {
  if (!isThemePreference(preference)) return themeState();
  const state = setThemePreference(preference);
  installAppMenu(APP_NAME, editorCommandsEnabled);
  return state;
});

ipcMain.handle('studio:listTakes', () => listTakes());

ipcMain.handle('studio:getTake', (_evt, takeId) => {
  const { takeDir, duration, manifest, autosaveNewer } = readStudioManifest(takeId);
  const media = mediaUrls(takeId);
  return { takeId, takeDir, duration, manifest, urls: media.urls, autosaveNewer };
});

ipcMain.handle('studio:saveManifest', (_evt, takeId, doc) => saveStudioManifest(takeId, doc));

ipcMain.handle('studio:apply', async (_evt, takeId) => {
  const { takeDir, manifest } = readStudioManifest(takeId);
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
    url: toMediaUrl(out),
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
  initTheme();
  installAppMenu(APP_NAME, editorCommandsEnabled);

  handleAppScheme({
    bundleDir: path.resolve(BUNDLE_DIR),
    mediaRoots: () => [outRoot()],
    documentHeaders: { 'content-security-policy': contentSecurityPolicy(IS_DEVELOPMENT) },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy(IS_DEVELOPMENT)],
      },
    });
  });

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
