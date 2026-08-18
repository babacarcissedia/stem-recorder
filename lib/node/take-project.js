'use strict';

const fs = require('fs');
const path = require('path');

const { probeDuration } = require('./ffmpeg-util.js');
const { readManifestDoc, MANIFEST_NAME } = require('./manifest-store.js');
const { defaultManifest } = require('./edit-manifest.js');
const {
  MANIFEST_SCHEMA_VERSION,
  V1_STEMS,
  detectSchemaVersion,
  migrateV1ToV2,
  readManifestV2,
} = require('../domain/manifest-v2.ts');

function stemDurations(takeDir) {
  const durations = {};
  for (const stem of V1_STEMS) {
    const stemPath = resolveFileBackedSourcePath(takeDir, stem.file);
    if (stemPath) durations[stem.file] = probeDuration(stemPath);
  }
  return durations;
}

function readRawManifest(takeDir) {
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return null;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function resolveFileBackedSourcePath(takeDir, sourcePath) {
  if (
    typeof sourcePath !== 'string'
    || sourcePath.length === 0
    || sourcePath.includes('\0')
    || sourcePath.startsWith('/')
    || sourcePath.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(sourcePath)
    || sourcePath.split('/').some((segment) => segment === '..')
    || sourcePath.includes('\\')
  ) {
    throw new Error('source path must be take-local');
  }

  const takeRoot = path.resolve(takeDir);
  const sourceFile = path.resolve(takeRoot, sourcePath);
  if (sourceFile !== takeRoot && !sourceFile.startsWith(`${takeRoot}${path.sep}`)) {
    throw new Error('source path must be take-local');
  }

  let sourceComponentPath = takeRoot;
  for (const sourceComponent of sourcePath.split('/')) {
    if (sourceComponent.length === 0) continue;
    sourceComponentPath = path.join(sourceComponentPath, sourceComponent);
    const sourceComponentStats = fs.lstatSync(sourceComponentPath, { throwIfNoEntry: false });
    if (!sourceComponentStats) return null;
    if (sourceComponentStats.isSymbolicLink()) throw new Error('source path must be take-local');
  }

  const sourceStats = fs.lstatSync(sourceFile, { throwIfNoEntry: false });
  return sourceStats?.isFile() ? sourceFile : null;
}

function inferredMissingDurations(raw, durations) {
  if (!raw || typeof raw !== 'object' || detectSchemaVersion(raw) !== 1) return durations;

  const next = { ...durations };
  const clips = Array.isArray(raw.clips) ? raw.clips : [];
  const fallbackSeconds = Math.max(1, ...Object.values(durations).filter((seconds) => seconds != null));
  for (const clip of clips) {
    const source = clip && typeof clip === 'object' ? clip.source || raw.source || 'screen.mp4' : raw.source || 'screen.mp4';
    if (!V1_STEMS.some((stem) => stem.file === source) || next[source] != null) continue;
    const clipOut = Number(clip && typeof clip === 'object' ? clip.out : null);
    next[source] = Number.isFinite(clipOut) && clipOut > 0 ? clipOut : fallbackSeconds;
  }
  return next;
}

function onDiskSchemaVersion(doc, migrated, generated) {
  if (generated) return 0;
  if (migrated) return 1;
  return detectSchemaVersion(doc);
}

function generatedProjectDoc(takeId, durations) {
  const sourceSeconds = durations['screen.mp4'] ?? durations['cam.mp4'] ?? null;
  const manifest = defaultManifest(takeId, sourceSeconds);
  if (Object.keys(durations).length > 0) return migrateV1ToV2(manifest, durations);

  manifest.clips = [];
  const doc = migrateV1ToV2(manifest, durations);
  doc.project.timeline.sources['src-screen'] = {
    path: 'screen.mp4',
    label: 'screen.mp4',
    kind: 'video',
    availableDuration: 0,
    hasAudio: false,
    present: false,
    origin: 'capture',
    peaksKey: null,
  };
  return doc;
}

function loadListedTakeProject(takeRoot, takeId) {
  const listedTake = typeof takeId === 'string' && fs.existsSync(takeRoot)
    ? fs.readdirSync(takeRoot, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name === takeId && entry.name.startsWith('take-'))
    : null;
  if (!listedTake) throw new Error(`take not found: ${takeId}`);

  return loadTakeProject(path.join(takeRoot, listedTake.name), listedTake.name);
}

function loadTakeProject(takeDir, takeId) {
  if (!fs.existsSync(takeDir)) throw new Error(`take not found: ${takeId}`);

  const raw = readRawManifest(takeDir);
  const durations = raw && detectSchemaVersion(raw) !== 1
    ? {}
    : inferredMissingDurations(raw, stemDurations(takeDir));
  const found = readManifestDoc(takeDir, durations);
  const generated = !found.doc;
  const doc = found.doc ?? generatedProjectDoc(takeId, durations);
  const { project, settings } = readManifestV2(doc);

  const missingSources = [];
  for (const source of project.timeline.sources.values()) {
    if (source.kind === 'text') {
      source.present = true;
      continue;
    }

    source.present = resolveFileBackedSourcePath(takeDir, source.path) !== null;
    if (!source.present) missingSources.push(source.path);
  }
  project.normalize();

  return {
    takeId,
    takeDir,
    schemaVersion: onDiskSchemaVersion(doc, found.migrated, generated),
    hasManifest: !generated,
    migrated: Boolean(found.migrated),
    backup: found.backup || null,
    missingSources,
    settings,
    project: project.toJSON(),
  };
}

module.exports = {
  MANIFEST_SCHEMA_VERSION,
  loadListedTakeProject,
  loadTakeProject,
  stemDurations,
};
