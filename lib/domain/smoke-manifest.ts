#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { InvariantError } from './invariant.ts';
import { Project } from './project.ts';
import type { V1Manifest } from './manifest-v2.ts';
import {
  MANIFEST_SCHEMA_VERSION,
  detectSchemaVersion,
  migrateV1ToV2,
  readManifestV2,
  toV1Compat,
} from './manifest-v2.ts';

const require_ = createRequire(import.meta.url);
const store = require_('../node/manifest-store.js');

let cases = 0;
function group(name: string, body: () => void): void {
  cases += 1;
  try {
    body();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof InvariantError, `expected InvariantError, got ${String(error)}`);
    return (error as InvariantError).code;
  }
  throw new assert.AssertionError({ message: 'expected an InvariantError, none thrown' });
};

const DURATIONS = { 'screen.mp4': 600, 'cam.mp4': 600, 'audio.mp3': 600 };

const v1: V1Manifest = {
  version: 1,
  takeId: 'take-001',
  source: 'screen.mp4',
  clips: [
    { id: 'clip-1', source: 'screen.mp4', in: 0, out: 4 },
    { id: 'clip-2', source: 'screen.mp4', in: 10.5, out: 12.25 },
    { id: 'clip-3', source: 'cam.mp4', in: 3, out: 5, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
  ],
  cam: { pip: false },
  vertical: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function tmpTake(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-manifest-'));
  fs.mkdirSync(path.join(dir, 'edit'), { recursive: true });
  return dir;
}

group('v1 seconds convert to integer milliseconds on every clip boundary', () => {
  const doc = migrateV1ToV2(v1, DURATIONS);
  const clips = doc.project.timeline.tracks[0]!.clips;
  assert.strictEqual(clips.length, 3);
  assert.deepStrictEqual(
    clips.map((clip) => [clip.sourceIn, clip.duration, clip.timelineStart]),
    [
      [0, 4_000, 0],
      [10_500, 1_750, 4_000],
      [3_000, 2_000, 5_750],
    ],
  );
  for (const clip of clips) {
    assert.ok(Number.isInteger(clip.sourceIn), `sourceIn not integer: ${clip.sourceIn}`);
    assert.ok(Number.isInteger(clip.duration), `duration not integer: ${clip.duration}`);
    assert.ok(Number.isInteger(clip.timelineStart), `timelineStart not integer`);
  }
});

group('fractional-second v1 boundaries round to the nearest millisecond', () => {
  const fractional: V1Manifest = {
    ...v1,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 1.0005, out: 2.0004 }],
  };
  const clip = migrateV1ToV2(fractional, DURATIONS).project.timeline.tracks[0]!.clips[0]!;
  assert.strictEqual(clip.sourceIn, 1_001);
  assert.strictEqual(clip.duration, 999);
  assert.strictEqual(Number.isInteger(clip.duration), true);
});

group('a null v1 out resolves to the source available duration', () => {
  const open: V1Manifest = {
    ...v1,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: null }],
  };
  const clip = migrateV1ToV2(open, DURATIONS).project.timeline.tracks[0]!.clips[0]!;
  assert.strictEqual(clip.duration, 600_000);
});

group('migrated documents load through Project.fromJSON', () => {
  const doc = migrateV1ToV2(v1, DURATIONS);
  const { project, settings } = readManifestV2(doc);
  assert.ok(project instanceof Project);
  assert.strictEqual(project.timeline.duration, 7_750);
  assert.strictEqual(settings.source, 'screen.mp4');
  assert.strictEqual(settings.vertical, true);
  assert.deepStrictEqual(settings.cam, { pip: false });
});

group('v2 round-trips to identical JSON', () => {
  const doc = migrateV1ToV2(v1, DURATIONS);
  const reloaded = Project.fromJSON(doc.project);
  assert.deepStrictEqual(reloaded.toJSON(), doc.project);
  assert.strictEqual(doc.project.timeline.timebase.unit, 'ms');
  assert.strictEqual(doc.schemaVersion, MANIFEST_SCHEMA_VERSION);
});

group('the compat adapter returns the v1 shape the current UI reads', () => {
  const back = toV1Compat(migrateV1ToV2(v1, DURATIONS));
  assert.strictEqual(back.version, 1);
  assert.strictEqual(back.takeId, 'take-001');
  assert.strictEqual(back.source, 'screen.mp4');
  assert.strictEqual(back.vertical, true);
  assert.deepStrictEqual(back.cam, { pip: false });
  assert.deepStrictEqual(
    back.clips.map((clip) => [clip.id, clip.source, clip.in, clip.out]),
    [
      ['clip-1', 'screen.mp4', 0, 4],
      ['clip-2', 'screen.mp4', 10.5, 12.25],
      ['clip-3', 'cam.mp4', 3, 5],
    ],
  );
  assert.deepStrictEqual(back.clips[2]!.crop, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
  assert.strictEqual('crop' in back.clips[0]!, false);
});

group('every v1 clip boundary survives the v1 to v2 to v1 round trip', () => {
  const back = toV1Compat(migrateV1ToV2(v1, DURATIONS));
  assert.deepStrictEqual(
    back.clips.map((clip) => ({ id: clip.id, source: clip.source, in: clip.in, out: clip.out })),
    v1.clips.map((clip) => ({ id: clip.id, source: clip.source, in: clip.in, out: clip.out })),
  );
});

group('freeze clips keep a positive duration and re-emit the v1 freeze flag', () => {
  const frozen: V1Manifest = {
    ...v1,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 2, out: 2, freeze: true }],
  };
  const doc = migrateV1ToV2(frozen, DURATIONS);
  const clip = doc.project.timeline.tracks[0]!.clips[0]!;
  assert.strictEqual(clip.duration, 100);
  const back = toV1Compat(doc);
  assert.strictEqual(back.clips[0]!.freeze, true);
  assert.strictEqual(back.clips[0]!.in, 2);
  assert.strictEqual(back.clips[0]!.out, 2);
});

group('schema version detection separates v1 from v2 and rejects the unknown', () => {
  assert.strictEqual(detectSchemaVersion(v1), 1);
  assert.strictEqual(detectSchemaVersion(migrateV1ToV2(v1, DURATIONS)), 2);
  assert.strictEqual(detectSchemaVersion(null), 0);
  assert.strictEqual(code(() => migrateV1ToV2(migrateV1ToV2(v1, DURATIONS) as never, DURATIONS)), 'NOT_A_V1_MANIFEST');
  assert.strictEqual(
    code(() => readManifestV2({ ...migrateV1ToV2(v1, DURATIONS), schemaVersion: 1 } as never)),
    'SCHEMA_VERSION_UNSUPPORTED',
  );
});

group('reading a v1 file on disk writes the backup before it migrates', () => {
  const takeDir = tmpTake();
  const manifestPath = path.join(takeDir, store.MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(v1, null, 2), 'utf8');

  const result = store.readManifestDoc(takeDir, DURATIONS);
  assert.strictEqual(result.migrated, true);

  const backupPath = path.join(takeDir, store.backupName(1));
  assert.ok(fs.existsSync(backupPath), 'pre-migration backup missing');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), v1);

  const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(onDisk.schemaVersion, 2);
  assert.strictEqual(store.readManifestDoc(takeDir, DURATIONS).migrated, false);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('the backup captures the pre-migration bytes even when migration then fails', () => {
  const takeDir = tmpTake();
  const manifestPath = path.join(takeDir, store.MANIFEST_NAME);
  const unmigratable = { ...v1, clips: [{ id: 'c', source: 'nope.mp4', in: 0, out: 1 }] };
  fs.writeFileSync(manifestPath, JSON.stringify(unmigratable, null, 2), 'utf8');

  assert.throws(() => store.readManifestDoc(takeDir, DURATIONS));
  const backupPath = path.join(takeDir, store.backupName(1));
  assert.ok(fs.existsSync(backupPath), 'backup must exist even though migration threw');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), unmigratable);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), unmigratable);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a failed atomic write leaves the previous document complete and no tmp behind', () => {
  const takeDir = tmpTake();
  const good = migrateV1ToV2(v1, DURATIONS);
  const manifestPath = store.writeManifestDoc(takeDir, good);
  const before = fs.readFileSync(manifestPath, 'utf8');

  fs.mkdirSync(`${manifestPath}.tmp`, { recursive: true });
  assert.throws(() => store.writeManifestDoc(takeDir, { ...good, takeId: 'clobbered' }));
  fs.rmSync(`${manifestPath}.tmp`, { recursive: true, force: true });

  const after = fs.readFileSync(manifestPath, 'utf8');
  assert.strictEqual(after, before);
  const reparsed = JSON.parse(after);
  assert.strictEqual(reparsed.takeId, 'take-001');
  assert.strictEqual(reparsed.schemaVersion, 2);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a successful atomic write replaces the target and clears the tmp file', () => {
  const takeDir = tmpTake();
  const doc = migrateV1ToV2(v1, DURATIONS);
  const manifestPath = store.writeManifestDoc(takeDir, doc);
  assert.strictEqual(fs.existsSync(`${manifestPath}.tmp`), false);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), doc);
  assert.strictEqual(fs.readFileSync(manifestPath, 'utf8').endsWith('\n'), true);

  const next = { ...doc, takeId: 'take-002' };
  store.writeManifestDoc(takeDir, next);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), next);
  assert.strictEqual(fs.existsSync(`${manifestPath}.tmp`), false);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('the recovery seam compares autosave against manifest on every open', () => {
  const takeDir = tmpTake();
  const doc = migrateV1ToV2(v1, DURATIONS);
  const manifestPath = store.writeManifestDoc(takeDir, doc);
  assert.strictEqual(store.autosaveIsNewer(takeDir), false);

  const autosavePath = path.join(takeDir, store.AUTOSAVE_NAME);
  fs.writeFileSync(autosavePath, JSON.stringify(doc, null, 2), 'utf8');
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(autosavePath, later, later);
  assert.strictEqual(store.autosaveIsNewer(takeDir), true);

  const earlier = new Date(Date.now() - 60_000);
  fs.utimesSync(autosavePath, earlier, earlier);
  assert.strictEqual(store.autosaveIsNewer(takeDir), false);
  assert.ok(fs.existsSync(manifestPath));
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('an absent take folder manifest reports no document rather than throwing', () => {
  const takeDir = tmpTake();
  const result = store.readManifestDoc(takeDir, DURATIONS);
  assert.strictEqual(result.doc, null);
  assert.strictEqual(result.migrated, false);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

console.log(JSON.stringify({ ok: true, cases }));
