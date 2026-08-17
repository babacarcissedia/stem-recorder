#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { MANIFEST_SCHEMA_VERSION, migrateV1ToV2, readManifestV2, toV1Compat } from '../lib/domain/manifest-v2.ts';
import type { ManifestV2, StemDurations, V1Manifest } from '../lib/domain/manifest-v2.ts';
import type { Project } from '../lib/domain/project.ts';

const require_ = createRequire(import.meta.url);
const store = require_('../lib/node/manifest-store.js');

type ContractFixture = {
  id: string;
  durationsSeconds: StemDurations;
  v1: V1Manifest;
  expectedCompat: V1Manifest;
};

const fixturesPath = path.join(import.meta.dirname, 'fixtures', 'v1-manifest-contracts.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8')) as ContractFixture[];

function tmpTake(id: string): string {
  const takeDir = fs.mkdtempSync(path.join(os.tmpdir(), `stem-migrate-${id}-`));
  fs.mkdirSync(path.join(takeDir, 'edit'), { recursive: true });
  return takeDir;
}

function assertIntegerBoundaries(project: Project, id: string): void {
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      assert.ok(Number.isInteger(clip.timelineStart), `${id}: ${clip.id} timelineStart must be an integer`);
      assert.ok(Number.isInteger(clip.duration), `${id}: ${clip.id} duration must be an integer`);
      assert.ok(Number.isInteger(clip.sourceIn), `${id}: ${clip.id} sourceIn must be an integer`);
      assert.ok(Number.isInteger(clip.sourceOut), `${id}: ${clip.id} sourceOut must be an integer`);
    }
  }
}

function assertDiskMigration(fixture: ContractFixture, migrated: ManifestV2): void {
  const takeDir = tmpTake(fixture.id);
  const manifestPath = path.join(takeDir, store.MANIFEST_NAME);
  const backupPath = path.join(takeDir, store.backupName(1));
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(fixture.v1, null, 2), 'utf8');

    const first = store.readManifestDoc(takeDir, fixture.durationsSeconds);
    assert.strictEqual(first.migrated, true, `${fixture.id}: first disk read must migrate`);
    assert.deepStrictEqual(first.doc, migrated, `${fixture.id}: disk migration must equal pure migration`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), fixture.v1, `${fixture.id}: backup must preserve V1`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), migrated, `${fixture.id}: disk manifest must be V2`);

    const backupBytes = fs.readFileSync(backupPath, 'utf8');
    const manifestBytes = fs.readFileSync(manifestPath, 'utf8');
    const second = store.readManifestDoc(takeDir, fixture.durationsSeconds);
    assert.strictEqual(second.migrated, false, `${fixture.id}: second disk read must not migrate`);
    assert.strictEqual(fs.readFileSync(backupPath, 'utf8'), backupBytes, `${fixture.id}: second read must not overwrite backup`);
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), manifestBytes, `${fixture.id}: second read must not overwrite manifest`);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(takeDir, 'edit')).filter((name) => /^manifest\.v\d+\.bak\.json$/.test(name)),
      ['manifest.v1.bak.json'],
      `${fixture.id}: second read must not create another backup`,
    );
  } finally {
    fs.rmSync(takeDir, { recursive: true, force: true });
  }
}

function assertFutureSchemaRefusal(fixture: ContractFixture): void {
  const takeDir = tmpTake('future-schema');
  const manifestPath = path.join(takeDir, store.MANIFEST_NAME);
  const future = { ...migrateV1ToV2(fixture.v1, fixture.durationsSeconds), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 };
  const originalBytes = JSON.stringify(future, null, 2);
  try {
    fs.writeFileSync(manifestPath, originalBytes, 'utf8');
    assert.throws(
      () => store.readManifestDoc(takeDir, fixture.durationsSeconds),
      (error: Error & { code?: string }) => error.code === 'FROM_THE_FUTURE',
      'future schema must be refused',
    );
    assert.strictEqual(fs.readFileSync(manifestPath, 'utf8'), originalBytes, 'future schema must leave manifest bytes unchanged');
    assert.deepStrictEqual(
      fs.readdirSync(path.join(takeDir, 'edit')).filter((name) => /^manifest\.v\d+\.bak\.json$/.test(name)),
      [],
      'future schema must not create a backup',
    );
  } finally {
    fs.rmSync(takeDir, { recursive: true, force: true });
  }
}

for (const fixture of fixtures) {
  const migrated = migrateV1ToV2(fixture.v1, fixture.durationsSeconds);
  assert.strictEqual(migrated.schemaVersion, 2, `${fixture.id}: migration must produce V2`);
  if (fixture.v1.cam != null) {
    assert.deepStrictEqual(migrated.settings.cam, fixture.v1.cam, `${fixture.id}: V2 settings must preserve V1 cam`);
  }
  if (fixture.v1.exportRate != null) {
    assert.strictEqual(migrated.settings.exportRate, fixture.v1.exportRate, `${fixture.id}: V2 settings must preserve V1 exportRate`);
  }
  const { project } = readManifestV2(migrated);
  assertIntegerBoundaries(project, fixture.id);
  assert.deepStrictEqual(toV1Compat(migrated), fixture.expectedCompat, `${fixture.id}: V1 compatibility contract changed`);
  assertDiskMigration(fixture, migrated);
}

assertFutureSchemaRefusal(fixtures[0]!);
console.log(JSON.stringify({ ok: true, fixtures: fixtures.length, futureSchemaRefusal: true }));
