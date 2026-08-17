'use strict';

const fs = require('fs');
const path = require('path');

const { probeDuration } = require('./ffmpeg-util.js');
const { readManifestDoc } = require('./manifest-store.js');
const { defaultManifest } = require('./edit-manifest.js');
const { V1_STEMS, detectSchemaVersion, migrateV1ToV2, readManifestV2 } = require('../domain/manifest-v2.ts');

function stemDurations(takeDir, missingStemSeconds) {
  const durations = {};
  for (const stem of V1_STEMS) {
    const stemPath = path.join(takeDir, stem.file);
    if (fs.existsSync(stemPath)) {
      const seconds = probeDuration(stemPath);
      if (seconds != null) durations[stem.file] = seconds;
    } else if (missingStemSeconds != null) {
      durations[stem.file] = missingStemSeconds;
    }
  }
  return durations;
}

// A missing stem has no probeable duration: zero leaves its clips unconstrained,
// and an open-ended v1 clip still needs a positive span, hence the third attempt.
function readDoc(takeDir) {
  const present = stemDurations(takeDir, null);
  const longest = Math.max(1, ...Object.values(present));
  let lastError = null;
  for (const missingStemSeconds of [null, 0, longest]) {
    const durations = missingStemSeconds == null ? present : stemDurations(takeDir, missingStemSeconds);
    try {
      return { ...readManifestDoc(takeDir, durations), durations };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function loadTakeProject(takeDir, takeId) {
  if (!fs.existsSync(takeDir)) throw new Error(`take not found: ${takeId}`);

  const found = readDoc(takeDir);
  let doc = found.doc;
  let onDiskSchemaVersion = doc ? 1 : 0;

  if (doc) {
    onDiskSchemaVersion = found.migrated ? 1 : detectSchemaVersion(doc);
  } else {
    const seconds = found.durations['screen.mp4'] ?? found.durations['cam.mp4'] ?? null;
    doc = migrateV1ToV2(defaultManifest(takeId, seconds), found.durations);
  }

  const { project, settings } = readManifestV2(doc);

  const missingSources = [];
  for (const source of project.timeline.sources.values()) {
    source.present = fs.existsSync(path.join(takeDir, source.path));
    if (!source.present) missingSources.push(source.path);
  }
  project.normalize();

  return {
    takeId,
    takeDir,
    schemaVersion: onDiskSchemaVersion,
    hasManifest: Boolean(found.doc),
    migrated: Boolean(found.migrated),
    backup: found.backup || null,
    missingSources,
    settings,
    project: project.toJSON(),
  };
}

module.exports = { loadTakeProject, stemDurations };
