'use strict';

const fs = require('fs');
const path = require('path');
const {
  MANIFEST_SCHEMA_VERSION,
  detectSchemaVersion,
  migrateV1ToV2,
  toV1Compat,
} = require('../domain/manifest-v2.ts');

const MANIFEST_NAME = 'edit/manifest.json';
const AUTOSAVE_NAME = 'edit/manifest.autosave.json';

function backupName(version) {
  return `edit/manifest.v${version}.bak.json`;
}

function writeAtomic(filePath, contents) {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp`;
  let fd;
  let tmpCreated = false;

  fs.mkdirSync(dir, { recursive: true });
  try {
    fd = fs.openSync(tmpPath, 'wx');
    tmpCreated = true;
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmpPath, filePath);
    tmpCreated = false;

    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
      }
    }
    if (tmpCreated) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
      }
    }
    throw error;
  }
  return filePath;
}

function writeAtomicJson(filePath, value) {
  return writeAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function snapshotBeforeMigration(takeDir, version) {
  const source = path.join(takeDir, MANIFEST_NAME);
  const target = path.join(takeDir, backupName(version));
  return writeAtomic(target, fs.readFileSync(source, 'utf8'));
}

function readManifestDoc(takeDir, durationsSeconds) {
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return { path: manifestPath, doc: null, migrated: false };
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = detectSchemaVersion(raw);
  if (version === MANIFEST_SCHEMA_VERSION) {
    return { path: manifestPath, doc: raw, migrated: false, backup: null };
  }
  if (version > MANIFEST_SCHEMA_VERSION) {
    const error = new Error(`manifest schemaVersion ${version} exceeds supported version ${MANIFEST_SCHEMA_VERSION}`);
    error.code = 'FROM_THE_FUTURE';
    throw error;
  }
  if (version !== 1) {
    const error = new Error(`unsupported manifest schemaVersion ${version}`);
    error.code = 'SCHEMA_VERSION_UNSUPPORTED';
    throw error;
  }
  const backup = snapshotBeforeMigration(takeDir, version);
  const doc = migrateV1ToV2(raw, durationsSeconds || {});
  writeAtomicJson(manifestPath, doc);
  return { path: manifestPath, doc, migrated: true, backup };
}

function writeManifestDoc(takeDir, doc) {
  return writeAtomicJson(path.join(takeDir, MANIFEST_NAME), doc);
}

function autosaveIsNewer(takeDir) {
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  const autosavePath = path.join(takeDir, AUTOSAVE_NAME);
  if (!fs.existsSync(autosavePath)) return false;
  if (!fs.existsSync(manifestPath)) return true;
  return fs.statSync(autosavePath).mtimeMs > fs.statSync(manifestPath).mtimeMs;
}

module.exports = {
  MANIFEST_NAME,
  AUTOSAVE_NAME,
  MANIFEST_SCHEMA_VERSION,
  backupName,
  writeAtomicJson,
  snapshotBeforeMigration,
  readManifestDoc,
  writeManifestDoc,
  autosaveIsNewer,
  toV1Compat,
};
