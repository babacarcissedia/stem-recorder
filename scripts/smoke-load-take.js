#!/usr/bin/env node
'use strict';

/**
 * Loads real takes off disk into a Project, because the synthetic manifests in
 * smoke-manifest never exercise capture-shaped folders (missing edit/, screen-only
 * takes, stems referenced after deletion).
 *
 * Every take is copied to a temp dir first: readManifestDoc migrates v1 in place
 * and writes a backup, and the recordings under the take root are not ours to edit.
 * Usage: node scripts/smoke-load-take.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findFfprobe } = require('../lib/node/ffmpeg-util.js');
const { loadTakeProject } = require('../lib/node/take-project.js');
const { backupName } = require('../lib/node/manifest-store.js');
const { Project } = require('../lib/domain/project.ts');

const TAKE_ROOT = process.env.STEM_OUT_ROOT
  || path.join(os.homedir(), 'Movies', 'stem-recorder');

let cases = 0;
function group(name, body) {
  cases += 1;
  try {
    body();
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
}

function skip(reason) {
  console.log(JSON.stringify({ ok: true, cases: 0, skipped: reason }));
  process.exit(0);
}

function takeWith(predicate) {
  if (!fs.existsSync(TAKE_ROOT)) return null;
  const names = fs.readdirSync(TAKE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const dir = path.join(TAKE_ROOT, name);
    if (predicate(dir)) return { id: name, dir };
  }
  return null;
}

const hasScreen = (dir) => fs.existsSync(path.join(dir, 'screen.mp4'));
const hasManifest = (dir) => fs.existsSync(path.join(dir, 'edit', 'manifest.json'));

function copyToTemp(take) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-load-take-'));
  const dir = path.join(root, take.id);
  fs.cpSync(take.dir, dir, { recursive: true });
  fs.rmSync(path.join(dir, 'edit', '.cache'), { recursive: true, force: true });
  return dir;
}

if (!findFfprobe()) skip('ffprobe not found (stem durations are probed)');

const v1Take = takeWith((dir) => hasScreen(dir) && hasManifest(dir));
const barTake = takeWith((dir) => hasScreen(dir) && !hasManifest(dir));
if (!v1Take && !barTake) skip(`no takes with stems under ${TAKE_ROOT}`);

if (v1Take) {
  const original = JSON.parse(fs.readFileSync(path.join(v1Take.dir, 'edit', 'manifest.json'), 'utf8'));
  assert.strictEqual(original.version, 1, `expected a v1 manifest in ${v1Take.id}`);

  group('a real v1 take migrates on load and yields the tracks and clips it declares', () => {
    const dir = copyToTemp(v1Take);
    const loaded = loadTakeProject(dir, v1Take.id);

    assert.strictEqual(loaded.schemaVersion, 1);
    assert.strictEqual(loaded.migrated, true);
    assert.strictEqual(loaded.hasManifest, true);
    assert.strictEqual(loaded.project.schemaVersion, 2);

    const project = Project.fromJSON(loaded.project);
    assert.strictEqual(project.timeline.takeId, v1Take.id);
    assert.strictEqual(project.timeline.trackCount, 1);

    const track = project.timeline.tracks[0];
    assert.strictEqual(track.kind, 'video');
    assert.strictEqual(track.clips.length, original.clips.length);
    for (const clip of track.clips) {
      assert.ok(Number.isInteger(clip.timelineStart), `timelineStart not integer: ${clip.timelineStart}`);
      assert.ok(Number.isInteger(clip.duration), `duration not integer: ${clip.duration}`);
      assert.ok(clip.duration > 0, 'every loaded clip has a positive duration');
      assert.ok(project.timeline.sources.has(clip.sourceId), `clip source missing: ${clip.sourceId}`);
    }
    assert.strictEqual(project.timeline.duration, track.clips.at(-1).timelineEnd);

    assert.ok(fs.existsSync(path.join(dir, backupName(1))), 'pre-migration backup missing');
    assert.strictEqual(loaded.missingSources.length, 0);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  group('a fractional-second v1 boundary lands on whole milliseconds', () => {
    const dir = copyToTemp(v1Take);
    fs.writeFileSync(
      path.join(dir, 'edit', 'manifest.json'),
      `${JSON.stringify({
        version: 1,
        takeId: v1Take.id,
        source: 'screen.mp4',
        clips: [{ id: 'clip-1', source: 'screen.mp4', in: 1.0005, out: 2.0004 }],
        updatedAt: '2026-01-01T00:00:00.000Z',
      }, null, 2)}\n`,
      'utf8',
    );

    const clip = Project.fromJSON(loadTakeProject(dir, v1Take.id).project).timeline.tracks[0].clips[0];
    assert.strictEqual(clip.sourceIn, 1_001);
    assert.strictEqual(clip.duration, 999);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  group('a stem the manifest still references but disk no longer has loads as absent', () => {
    const dir = copyToTemp(v1Take);
    fs.rmSync(path.join(dir, 'screen.mp4'));

    const loaded = loadTakeProject(dir, v1Take.id);
    assert.deepStrictEqual(loaded.missingSources, ['screen.mp4']);

    const project = Project.fromJSON(loaded.project);
    const screen = [...project.timeline.sources.values()].find((source) => source.path === 'screen.mp4');
    assert.ok(screen, 'the referenced source survives so its clips still render');
    assert.strictEqual(screen.present, false);
    assert.strictEqual(project.timeline.tracks[0].clips.length, 1);
    assert.notStrictEqual(project.audioRoute.activeSourceId, screen.id);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });
}

if (barTake) {
  group('a take with no edit folder loads a full-length clip instead of failing', () => {
    const dir = copyToTemp(barTake);
    assert.strictEqual(fs.existsSync(path.join(dir, 'edit', 'manifest.json')), false);

    const loaded = loadTakeProject(dir, barTake.id);
    assert.strictEqual(loaded.hasManifest, false);
    assert.strictEqual(loaded.migrated, false);
    assert.strictEqual(loaded.schemaVersion, 0);
    assert.strictEqual(fs.existsSync(path.join(dir, 'edit', 'manifest.json')), false, 'loading must not create a manifest');

    const project = Project.fromJSON(loaded.project);
    assert.strictEqual(project.timeline.trackCount, 1);
    assert.strictEqual(project.timeline.tracks[0].clips.length, 1);
    assert.ok(project.timeline.duration > 0, 'the default clip spans the recorded screen stem');
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });
}

const screenOnly = takeWith((dir) => hasScreen(dir) && !fs.existsSync(path.join(dir, 'cam.mp4')));
if (screenOnly) {
  group('a take captured without a cam stem loads with no cam source', () => {
    const dir = copyToTemp(screenOnly);
    const project = Project.fromJSON(loadTakeProject(dir, screenOnly.id).project);
    const paths = [...project.timeline.sources.values()].map((source) => source.path);
    assert.ok(!paths.includes('cam.mp4'), `cam source invented for a cam-less take: ${paths.join(',')}`);
    assert.ok(paths.includes('screen.mp4'));
    assert.ok(project.timeline.tracks[0].clips.length >= 1);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });
}

console.log(JSON.stringify({ ok: true, cases }));
