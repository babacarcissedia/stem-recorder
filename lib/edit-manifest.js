'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { outRoot } = require('./paths');
const { probeDuration } = require('./ffmpeg-util');
const { normalizeCrop, normalizeCam, normalizeExportRate, normalizeMusic } = require('./clip-ops');

const MANIFEST_NAME = 'edit/manifest.json';
const FINAL_NAME = 'edit/final.mp4';
const PRE_BURN_FINAL_NAME = 'edit/final-no-captions.mp4';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listTakes() {
  const root = outRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('take-'))
    .map((d) => {
      const takeDir = path.join(root, d.name);
      const screen = path.join(takeDir, 'screen.mp4');
      const cam = path.join(takeDir, 'cam.mp4');
      const audio = path.join(takeDir, 'audio.mp3');
      const manifestPath = path.join(takeDir, MANIFEST_NAME);
      const finalPath = path.join(takeDir, FINAL_NAME);
      return {
        id: d.name,
        dir: takeDir,
        hasScreen: fs.existsSync(screen),
        hasCam: fs.existsSync(cam),
        hasAudio: fs.existsSync(audio),
        hasManifest: fs.existsSync(manifestPath),
        hasFinal: fs.existsSync(finalPath),
        mtimeMs: fs.statSync(takeDir).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function takeDirFor(takeId) {
  if (!takeId || /[^a-zA-Z0-9._-]/.test(takeId)) {
    throw new Error('invalid take id');
  }
  const takeDir = path.join(outRoot(), takeId);
  if (!fs.existsSync(takeDir)) throw new Error(`take not found: ${takeId}`);
  return takeDir;
}

function defaultManifest(takeId, duration) {
  return {
    version: 1,
    takeId,
    source: 'screen.mp4',
    clips: [
      {
        id: 'clip-1',
        source: 'screen.mp4',
        in: 0,
        out: duration != null ? duration : null,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeManifest(doc, takeId, duration) {
  if (!doc || typeof doc !== 'object') return defaultManifest(takeId, duration);
  let clips = Array.isArray(doc.clips) ? doc.clips : null;
  if (!clips && (doc.keepFrom != null || doc.keepTo != null)) {
    clips = [{
      id: 'clip-1',
      source: doc.source || 'screen.mp4',
      in: Number(doc.keepFrom || 0),
      out: doc.keepTo != null ? Number(doc.keepTo) : null,
    }];
  }
  if (!clips || !clips.length) clips = defaultManifest(takeId, duration).clips;
  const cam = normalizeCam(doc.cam);
  // Edit-T2d: caption burn-in is opt-in — only the explicit ON is stored.
  const captions = doc.captions && doc.captions.burn === true ? { burn: true } : null;
  // Edit-T2e: constant export speed (absent = 1×) + optional music bed.
  const exportRate = normalizeExportRate(doc.exportRate);
  const music = normalizeMusic(doc.music);
  return {
    version: 1,
    takeId,
    source: doc.source || 'screen.mp4',
    ...(cam ? { cam } : {}),
    ...(captions ? { captions } : {}),
    ...(exportRate ? { exportRate } : {}),
    ...(music ? { music } : {}),
    clips: clips.map((c, i) => {
      const crop = normalizeCrop(c.crop);
      return {
        id: c.id || `clip-${i + 1}`,
        source: c.source || 'screen.mp4',
        in: Number(c.in ?? 0),
        out: c.out == null ? null : Number(c.out),
        ...(crop ? { crop } : {}),
        ...(c.freeze === true ? { freeze: true } : {}),
      };
    }),
    updatedAt: doc.updatedAt || new Date().toISOString(),
  };
}

function readManifest(takeId) {
  const takeDir = takeDirFor(takeId);
  const screen = path.join(takeDir, 'screen.mp4');
  const duration = fs.existsSync(screen) ? probeDuration(screen) : null;
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    return { takeDir, duration, manifest: defaultManifest(takeId, duration), path: manifestPath };
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    takeDir,
    duration,
    manifest: normalizeManifest(raw, takeId, duration),
    path: manifestPath,
  };
}

function writeManifest(takeId, doc) {
  const takeDir = takeDirFor(takeId);
  const editDir = path.join(takeDir, 'edit');
  ensureDir(editDir);
  const screen = path.join(takeDir, 'screen.mp4');
  const duration = fs.existsSync(screen) ? probeDuration(screen) : null;
  const manifest = normalizeManifest({ ...doc, updatedAt: new Date().toISOString() }, takeId, duration);
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { path: manifestPath, manifest };
}

function mediaUrls(takeId) {
  const takeDir = takeDirFor(takeId);
  const map = {};
  for (const name of ['screen.mp4', 'cam.mp4', 'audio.mp3', FINAL_NAME]) {
    const p = path.join(takeDir, name);
    if (fs.existsSync(p)) map[name] = pathToFileURL(p).href;
  }
  return { takeDir, urls: map };
}

module.exports = {
  MANIFEST_NAME,
  FINAL_NAME,
  PRE_BURN_FINAL_NAME,
  listTakes,
  takeDirFor,
  readManifest,
  writeManifest,
  mediaUrls,
  defaultManifest,
  normalizeManifest,
};
