#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { InvariantError } from '../lib/domain/invariant.ts';
import { Project } from '../lib/domain/project.ts';
import type { V1Manifest } from '../lib/domain/manifest-v2.ts';
import type { Source } from '../lib/domain/source.ts';
import {
  MANIFEST_SCHEMA_VERSION,
  detectSchemaVersion,
  migrateV1ToV2,
  readManifestV2,
  resolveDialogueSource,
  resolveLegacyDialogueSource,
  toV1Compat,
} from '../lib/domain/manifest-v2.ts';

const require_ = createRequire(import.meta.url);
const store = require_('../lib/node/manifest-store.js');
const { resolveTakeLocalDialoguePath } = require_('../lib/node/ffmpeg-util.js');

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

function compatibleAudioSource(id: string, path: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    path,
    label: path,
    kind: 'audio',
    availableDuration: 600_000,
    hasAudio: true,
    present: true,
    origin: 'import',
    peaksKey: null,
    ...overrides,
  };
}

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

group('three-stem v1 migration defaults dialogue to the separately captured microphone file', () => {
  const doc = migrateV1ToV2(v1, DURATIONS);
  assert.deepStrictEqual(doc.project.audioRoute, { activeSourceId: 'src-audio', resolvedBy: 'auto' });
  assert.strictEqual(resolveDialogueSource(doc), 'audio.mp3');
  assert.deepStrictEqual(toV1Compat(doc).audioRoute, doc.project.audioRoute);
});

group('legacy camera audio resolves when no separate microphone stem exists', () => {
  const doc = migrateV1ToV2(v1, { 'screen.mp4': 600, 'cam.mp4': 600 });
  assert.deepStrictEqual(doc.project.audioRoute, { activeSourceId: 'src-cam', resolvedBy: 'auto' });
  assert.strictEqual(resolveDialogueSource(doc), 'cam.mp4');
});

group('manifest-less takes resolve dialogue through the V1 source route', () => {
  assert.strictEqual(resolveLegacyDialogueSource(DURATIONS), 'audio.mp3');
  assert.strictEqual(resolveLegacyDialogueSource({ 'screen.mp4': 600, 'cam.mp4': 600 }), 'cam.mp4');
  assert.strictEqual(resolveLegacyDialogueSource({ 'screen.mp4': 600 }), null);
  assert.strictEqual(resolveLegacyDialogueSource({}), null);
});

group('compatibility audio sources reject reserved V1 source ID collisions', () => {
  assert.strictEqual(
    code(() => migrateV1ToV2({
      ...v1,
      compatAudioSources: [compatibleAudioSource('src-audio', 'dialogue.m4a')],
    }, DURATIONS)),
    'COMPAT_AUDIO_SOURCE_ID_CONFLICT',
  );
});

group('every reserved V1 source ID rejects a noncanonical compatibility definition', () => {
  for (const sourceId of ['src-cam', 'src-screen', 'src-audio']) {
    assert.strictEqual(
      code(() => migrateV1ToV2({
        ...v1,
        compatAudioSources: [compatibleAudioSource(sourceId, 'dialogue.m4a', {
          kind: 'video',
          origin: 'capture',
        })],
      }, DURATIONS)),
      'COMPAT_AUDIO_SOURCE_ID_CONFLICT',
      sourceId,
    );
  }
});

group('canonical reserved screen compatibility sources retain the generated source', () => {
  const doc = migrateV1ToV2({
    ...v1,
    compatAudioSources: [compatibleAudioSource('src-screen', 'screen.mp4', {
      kind: 'video',
      hasAudio: false,
      origin: 'capture',
    })],
  }, DURATIONS);
  assert.deepStrictEqual(doc.project.timeline.sources['src-screen'], {
    path: 'screen.mp4',
    label: 'screen.mp4',
    kind: 'video',
    availableDuration: 600_000,
    hasAudio: false,
    present: true,
    origin: 'capture',
    peaksKey: null,
  });
});

group('reserved V1 compatibility IDs conflict when their stems are absent', () => {
  assert.strictEqual(
    code(() => migrateV1ToV2({
      ...v1,
      compatAudioSources: [compatibleAudioSource('src-audio', 'audio.mp3', { origin: 'capture' })],
    }, { 'screen.mp4': 600, 'cam.mp4': 600 })),
    'COMPAT_AUDIO_SOURCE_ID_CONFLICT',
  );
});

group('a take-local dialogue source survives the Get Save Apply compatibility round trip', () => {
  const initial = migrateV1ToV2(v1, DURATIONS);
  initial.project.timeline.sources['src-dialogue'] = {
    path: 'dialogue.m4a',
    label: 'dialogue.m4a',
    kind: 'audio',
    availableDuration: 600_000,
    hasAudio: true,
    present: true,
    origin: 'import',
    peaksKey: null,
  };
  initial.project.audioRoute = { activeSourceId: 'src-dialogue', resolvedBy: 'user' };

  const get = toV1Compat(initial);
  const saved = migrateV1ToV2(get, DURATIONS);

  assert.deepStrictEqual(
    get.compatAudioSources?.filter((source) => ['src-cam', 'src-audio'].includes(source.id)),
    ['src-cam', 'src-audio'].map((sourceId) => ({
      id: sourceId,
      ...initial.project.timeline.sources[sourceId]!,
    })),
  );
  assert.strictEqual(get.compatAudioSources?.some((source) => source.id === 'src-dialogue'), true);
  assert.deepStrictEqual(saved.project.timeline.sources['src-dialogue'], initial.project.timeline.sources['src-dialogue']);
  assert.deepStrictEqual(saved.project.audioRoute, { activeSourceId: 'src-dialogue', resolvedBy: 'user' });
  assert.strictEqual(resolveDialogueSource(saved), 'dialogue.m4a');

  const takeDir = tmpTake();
  const dialoguePath = path.join(takeDir, 'dialogue.m4a');
  fs.writeFileSync(dialoguePath, 'fixture');
  try {
    assert.strictEqual(resolveTakeLocalDialoguePath(takeDir, resolveDialogueSource(saved)), fs.realpathSync(dialoguePath));
  } finally {
    fs.rmSync(takeDir, { recursive: true, force: true });
  }
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

group('freeze clips preserve their non-zero v1 hold duration through compat', () => {
  const frozen: V1Manifest = {
    ...v1,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 10, out: 11.5, freeze: true }],
  };
  const doc = migrateV1ToV2(frozen, DURATIONS);
  const clip = doc.project.timeline.tracks[0]!.clips[0]!;
  assert.strictEqual(clip.duration, 1_500);
  const back = toV1Compat(doc);
  assert.strictEqual(back.clips[0]!.freeze, true);
  assert.strictEqual(back.clips[0]!.in, 10);
  assert.strictEqual(back.clips[0]!.out, 11.5);
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

group('a write failure after staging removes only the operation tmp file', () => {
  const takeDir = tmpTake();
  const target = path.join(takeDir, 'edit', 'write-failure.json');
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('injected write failure'); };
  try {
    assert.throws(() => store.writeAtomicJson(target, migrateV1ToV2(v1, DURATIONS)));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'staged tmp file leaked after a write failure');
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('an fsync failure after staging removes the operation tmp file', () => {
  const takeDir = tmpTake();
  const target = path.join(takeDir, 'edit', 'fsync-failure.json');
  const originalFsyncSync = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('injected fsync failure'); };
  try {
    assert.throws(() => store.writeAtomicJson(target, migrateV1ToV2(v1, DURATIONS)));
  } finally {
    fs.fsyncSync = originalFsyncSync;
  }
  assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'staged tmp file leaked after an fsync failure');
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a close failure after staging removes the operation tmp file', () => {
  const takeDir = tmpTake();
  const target = path.join(takeDir, 'edit', 'close-failure.json');
  const originalCloseSync = fs.closeSync;
  let closeCalls = 0;
  fs.closeSync = (fd) => {
    closeCalls += 1;
    if (closeCalls === 1) throw new Error('injected close failure');
    return originalCloseSync(fd);
  };
  try {
    assert.throws(() => store.writeAtomicJson(target, migrateV1ToV2(v1, DURATIONS)));
  } finally {
    fs.closeSync = originalCloseSync;
  }
  assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'staged tmp file leaked after a close failure');
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a backup write failure after staging removes its operation tmp file', () => {
  const takeDir = tmpTake();
  const source = path.join(takeDir, store.MANIFEST_NAME);
  fs.writeFileSync(source, JSON.stringify(v1), 'utf8');
  const target = path.join(takeDir, store.backupName(1));
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = () => { throw new Error('injected backup write failure'); };
  try {
    assert.throws(() => store.snapshotBeforeMigration(takeDir, 1));
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'backup tmp file leaked after a write failure');
  assert.strictEqual(fs.existsSync(target), false);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(source, 'utf8')), v1);
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a pre-existing tmp file is never replaced or removed by another operation', () => {
  const takeDir = tmpTake();
  const target = path.join(takeDir, 'edit', 'occupied.json');
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, 'unrelated', 'utf8');

  assert.throws(() => store.writeAtomicJson(target, migrateV1ToV2(v1, DURATIONS)));
  assert.strictEqual(fs.readFileSync(temp, 'utf8'), 'unrelated');
  fs.rmSync(takeDir, { recursive: true, force: true });
});

group('a rename that fails removes the staged tmp file instead of leaking it', () => {
  const takeDir = tmpTake();
  const target = path.join(takeDir, 'edit', 'occupied.json');
  fs.mkdirSync(target, { recursive: true });

  assert.throws(() => store.writeAtomicJson(target, migrateV1ToV2(v1, DURATIONS)));
  assert.strictEqual(fs.existsSync(`${target}.tmp`), false, 'staged tmp file leaked after a failed rename');
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
