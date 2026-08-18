#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { spawnSync } = require('child_process');
const { findFfmpeg, findFfprobe, runFfmpeg } = require('../lib/node/ffmpeg-util.js');
const { loadListedTakeProject, loadTakeProject } = require('../lib/node/take-project.js');
const { migrateV1ToV2 } = require('../lib/domain/manifest-v2.ts');
const { backupName, MANIFEST_NAME } = require('../lib/node/manifest-store.js');
const { Project } = require('../lib/domain/project.ts');

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

function takeIdFor(name) {
  return `take-${name}`;
}

function makeTake(root, name) {
  const takeId = takeIdFor(name);
  const takeDir = path.join(root, takeId);
  fs.mkdirSync(takeDir, { recursive: true });
  return { takeId, takeDir };
}

async function makeMedia(filePath, kind, seconds = 1) {
  const ffmpeg = findFfmpeg();
  assert.ok(ffmpeg, 'ffmpeg required for smoke-load-take fixtures');
  const args = kind === 'audio'
    ? [
        '-hide_banner', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', String(seconds),
        '-c:a', 'libmp3lame', '-b:a', '96k',
        filePath,
      ]
    : [
        '-hide_banner', '-y',
        '-f', 'lavfi', '-i', `testsrc=size=64x64:rate=30:duration=${seconds}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-pix_fmt', 'yuv420p', '-an',
        filePath,
      ];
  await runFfmpeg(ffmpeg, args);
}

function writeManifest(takeDir, doc) {
  const manifestPath = path.join(takeDir, MANIFEST_NAME);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function findTakeRoot() {
  const roots = [
    process.env.STEM_OUT_ROOT,
    path.join(os.homedir(), 'Movies', 'stem-recorder'),
  ].filter(Boolean);
  return roots.find((root) => fs.existsSync(root)) || null;
}

function copyRealTakeIfAvailable(workRoot) {
  const takeRoot = findTakeRoot();
  if (!takeRoot) return null;
  const entry = fs.readdirSync(takeRoot, { withFileTypes: true })
    .find((candidate) => candidate.isDirectory() && candidate.name.startsWith('take-'));
  if (!entry) return null;

  const source = path.join(takeRoot, entry.name);
  const destination = path.join(workRoot, `real-${entry.name}`);
  fs.cpSync(source, destination, { recursive: true });
  fs.rmSync(path.join(destination, 'edit', '.cache'), { recursive: true, force: true });
  return { takeId: path.basename(destination), takeDir: destination };
}

async function main() {
  assert.ok(findFfprobe(), 'ffprobe required for smoke-load-take fixture duration probes');
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-load-take-'));

  try {
    const screenOnly = makeTake(workRoot, 'screen-only');
    await makeMedia(path.join(screenOnly.takeDir, 'screen.mp4'), 'video', 1.25);

    group('manifest-less screen take loads as a v2 project without writing a manifest', () => {
      const loaded = loadTakeProject(screenOnly.takeDir, screenOnly.takeId);
      assert.strictEqual(loaded.hasManifest, false);
      assert.strictEqual(loaded.migrated, false);
      assert.strictEqual(loaded.schemaVersion, 0);
      assert.strictEqual(loaded.project.schemaVersion, 2);
      assert.strictEqual(fs.existsSync(path.join(screenOnly.takeDir, MANIFEST_NAME)), false);

      const project = Project.fromJSON(loaded.project);
      assert.strictEqual(project.timeline.takeId, screenOnly.takeId);
      assert.strictEqual(project.timeline.trackCount, 1);
      assert.strictEqual(project.timeline.tracks[0].clips.length, 1);
      assert.ok(project.timeline.tracks[0].clips[0].duration > 0);
    });

    const empty = makeTake(workRoot, 'empty');
    group('manifest-less empty listed take loads as an empty v2 project with its missing source explicit', () => {
      const loaded = loadListedTakeProject(workRoot, empty.takeId);
      assert.strictEqual(loaded.hasManifest, false);
      assert.strictEqual(loaded.migrated, false);
      assert.strictEqual(loaded.schemaVersion, 0);
      assert.strictEqual(loaded.project.schemaVersion, 2);
      assert.deepStrictEqual(loaded.missingSources, ['screen.mp4']);
      assert.strictEqual(fs.existsSync(path.join(empty.takeDir, MANIFEST_NAME)), false);

      const project = Project.fromJSON(loaded.project);
      assert.strictEqual(project.timeline.takeId, empty.takeId);
      assert.strictEqual(project.timeline.trackCount, 1);
      assert.strictEqual(project.timeline.tracks[0].clips.length, 0);
      const screen = project.timeline.source('src-screen');
      assert.strictEqual(screen.present, false);
      assert.strictEqual(screen.availableDuration, 0);
      assert.strictEqual(project.audioRoute.activeSourceId, null);
      assert.strictEqual(project.audioRoute.resolvedBy, 'auto');
    });

    const v1 = makeTake(workRoot, 'v1');
    await makeMedia(path.join(v1.takeDir, 'screen.mp4'), 'video', 2);
    await makeMedia(path.join(v1.takeDir, 'audio.mp3'), 'audio', 2);
    writeManifest(v1.takeDir, {
      version: 1,
      takeId: v1.takeId,
      source: 'screen.mp4',
      audioRoute: { activeSourceId: 'src-audio', resolvedBy: 'user' },
      clips: [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: 1.5 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    group('v1 manifest take migrates through the manifest store', () => {
      const loaded = loadTakeProject(v1.takeDir, v1.takeId);
      assert.strictEqual(loaded.hasManifest, true);
      assert.strictEqual(loaded.migrated, true);
      assert.strictEqual(loaded.schemaVersion, 1);
      assert.strictEqual(loaded.project.schemaVersion, 2);
      assert.ok(loaded.backup);
      assert.ok(fs.existsSync(path.join(v1.takeDir, backupName(1))));

      const project = Project.fromJSON(loaded.project);
      const clip = project.timeline.tracks[0].clips[0];
      assert.ok(Number.isInteger(clip.duration));
      assert.ok(clip.duration > 0);
    });

    const missing = makeTake(workRoot, 'missing-source');
    await makeMedia(path.join(missing.takeDir, 'audio.mp3'), 'audio', 2);
    writeManifest(missing.takeDir, {
      version: 1,
      takeId: missing.takeId,
      source: 'screen.mp4',
      audioRoute: { activeSourceId: 'src-screen', resolvedBy: 'user' },
      clips: [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: 1 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    group('missing referenced sources are reported and marked absent', () => {
      const loaded = loadTakeProject(missing.takeDir, missing.takeId);
      assert.deepStrictEqual(loaded.missingSources, ['screen.mp4']);

      const project = Project.fromJSON(loaded.project);
      const screen = [...project.timeline.sources.values()].find((source) => source.path === 'screen.mp4');
      assert.ok(screen);
      assert.strictEqual(screen.present, false);
      assert.strictEqual(project.timeline.tracks[0].clips.length, 1);
    });

    group('audio route normalizes away from an absent active source', () => {
      const project = Project.fromJSON(loadTakeProject(missing.takeDir, missing.takeId).project);
      assert.notStrictEqual(project.audioRoute.activeSourceId, 'src-screen');
      assert.strictEqual(project.audioRoute.activeSourceId, 'src-audio');
      assert.strictEqual(project.audioRoute.resolvedBy, 'auto');
    });

    const textOverlay = makeTake(workRoot, 'text-overlay');
    const textOverlayManifest = migrateV1ToV2({
      version: 1,
      takeId: textOverlay.takeId,
      source: 'screen.mp4',
      clips: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, {});
    textOverlayManifest.project.timeline.sources['src-title'] = {
      path: '',
      label: 'Title',
      kind: 'text',
      availableDuration: 0,
      hasAudio: false,
      present: true,
      origin: 'generated',
      peaksKey: null,
    };
    writeManifest(textOverlay.takeDir, textOverlayManifest);

    group('persisted v2 text overlay sources load without filesystem probing', () => {
      const originalLstatSync = fs.lstatSync;
      fs.lstatSync = () => { throw new Error('virtual sources must not be probed'); };
      try {
        const loaded = loadTakeProject(textOverlay.takeDir, textOverlay.takeId);
        assert.deepStrictEqual(loaded.missingSources, []);

        const project = Project.fromJSON(loaded.project);
        const title = project.timeline.source('src-title');
        assert.strictEqual(title.path, '');
        assert.strictEqual(title.kind, 'text');
        assert.strictEqual(title.present, true);
      } finally {
        fs.lstatSync = originalLstatSync;
      }
    });

    const maliciousV2 = makeTake(workRoot, 'malicious-v2');
    const outsidePath = path.join(workRoot, 'outside.mp4');
    writeManifest(maliciousV2.takeDir, migrateV1ToV2({
      version: 1,
      takeId: maliciousV2.takeId,
      source: 'screen.mp4',
      clips: [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: 1 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, { 'screen.mp4': 1 }));
    const maliciousManifestPath = path.join(maliciousV2.takeDir, MANIFEST_NAME);
    const maliciousManifest = JSON.parse(fs.readFileSync(maliciousManifestPath, 'utf8'));
    maliciousManifest.project.timeline.sources['src-screen'].path = '../outside.mp4';
    writeManifest(maliciousV2.takeDir, maliciousManifest);

    group('v2 source paths reject empty, absolute, backslash, NUL, and traversal values', () => {
      for (const sourcePath of ['', '/outside.mp4', 'C:\\outside.mp4', 'screen\0.mp4', '../outside.mp4']) {
        maliciousManifest.project.timeline.sources['src-screen'].path = sourcePath;
        writeManifest(maliciousV2.takeDir, maliciousManifest);
        assert.throws(
          () => loadTakeProject(maliciousV2.takeDir, maliciousV2.takeId),
          /source path must be take-local/,
        );
      }
    });

    maliciousManifest.project.timeline.sources['src-screen'].path = '../outside.mp4';
    writeManifest(maliciousV2.takeDir, maliciousManifest);
    group('v2 source traversal is rejected before the loader probes outside the take', () => {
      const originalExistsSync = fs.existsSync;
      const originalLstatSync = fs.lstatSync;
      const probedPaths = [];
      const recordProbe = (candidate) => {
        const resolved = path.resolve(candidate);
        if (resolved === outsidePath) probedPaths.push(resolved);
      };
      fs.existsSync = (candidate) => {
        recordProbe(candidate);
        return originalExistsSync(candidate);
      };
      fs.lstatSync = (candidate, options) => {
        recordProbe(candidate);
        return originalLstatSync(candidate, options);
      };
      try {
        assert.throws(
          () => loadTakeProject(maliciousV2.takeDir, maliciousV2.takeId),
          /source path must be take-local/,
        );
      } finally {
        fs.existsSync = originalExistsSync;
        fs.lstatSync = originalLstatSync;
      }
      assert.deepStrictEqual(probedPaths, []);
    });

    group('v2 source symlink ancestors are rejected before probing the external descendant', () => {
      const externalRoot = path.join(workRoot, 'external-source-root');
      const externalSource = path.join(externalRoot, 'outside.mp4');
      const linkedSource = path.join(maliciousV2.takeDir, 'linked', 'outside.mp4');
      fs.mkdirSync(externalRoot);
      fs.writeFileSync(externalSource, 'outside');
      fs.symlinkSync(externalRoot, path.join(maliciousV2.takeDir, 'linked'), 'dir');
      maliciousManifest.project.timeline.sources['src-screen'].path = 'linked/outside.mp4';
      writeManifest(maliciousV2.takeDir, maliciousManifest);

      const originalExistsSync = fs.existsSync;
      const originalLstatSync = fs.lstatSync;
      const externalDescendantProbes = [];
      const recordExternalDescendantProbe = (candidate) => {
        if (path.resolve(candidate) === linkedSource) externalDescendantProbes.push(candidate);
      };
      fs.existsSync = (candidate) => {
        recordExternalDescendantProbe(candidate);
        return originalExistsSync(candidate);
      };
      fs.lstatSync = (candidate, options) => {
        recordExternalDescendantProbe(candidate);
        return originalLstatSync(candidate, options);
      };
      try {
        assert.throws(
          () => loadTakeProject(maliciousV2.takeDir, maliciousV2.takeId),
          /source path must be take-local/,
        );
      } finally {
        fs.existsSync = originalExistsSync;
        fs.lstatSync = originalLstatSync;
      }
      assert.deepStrictEqual(externalDescendantProbes, []);
    });

    const symlinkedStem = makeTake(workRoot, 'symlinked-stem');
    const externalStem = path.join(workRoot, 'external-screen.mp4');
    const probeLogPath = path.join(workRoot, 'ffprobe.log');
    const fakeFfprobePath = path.join(workRoot, 'fake-ffprobe.sh');
    await makeMedia(externalStem, 'video');
    fs.symlinkSync(externalStem, path.join(symlinkedStem.takeDir, 'screen.mp4'), 'file');
    fs.writeFileSync(fakeFfprobePath, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$STEM_PROBE_LOG"\n', { mode: 0o755 });
    group('manifest-less symlinked stems are rejected before duration probing', () => {
      const originalFfprobePath = process.env.FFPROBE_PATH;
      const originalProbeLogPath = process.env.STEM_PROBE_LOG;
      process.env.FFPROBE_PATH = fakeFfprobePath;
      process.env.STEM_PROBE_LOG = probeLogPath;
      try {
        assert.throws(
          () => loadTakeProject(symlinkedStem.takeDir, symlinkedStem.takeId),
          /source path must be take-local/,
        );
      } finally {
        if (originalFfprobePath === undefined) delete process.env.FFPROBE_PATH;
        else process.env.FFPROBE_PATH = originalFfprobePath;
        if (originalProbeLogPath === undefined) delete process.env.STEM_PROBE_LOG;
        else process.env.STEM_PROBE_LOG = originalProbeLogPath;
      }
      assert.strictEqual(fs.existsSync(probeLogPath), false);
    });

    const nonRegularV2 = makeTake(workRoot, 'non-regular-v2');
    const nonRegularManifest = migrateV1ToV2({
      version: 1,
      takeId: nonRegularV2.takeId,
      source: 'screen.mp4',
      clips: [{ id: 'clip-1', source: 'screen.mp4', in: 0, out: 1 }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, { 'screen.mp4': 1 });
    fs.mkdirSync(path.join(nonRegularV2.takeDir, 'edit'));
    group('v2 file-backed root and directories are missing sources', () => {
      for (const sourcePath of ['.', 'edit/']) {
        nonRegularManifest.project.timeline.sources['src-screen'].path = sourcePath;
        writeManifest(nonRegularV2.takeDir, nonRegularManifest);
        const loaded = loadTakeProject(nonRegularV2.takeDir, nonRegularV2.takeId);
        const project = Project.fromJSON(loaded.project);
        assert.deepStrictEqual(loaded.missingSources, [sourcePath]);
        assert.strictEqual(project.timeline.source('src-screen').present, false);
      }
    });

    const legacy = makeTake(workRoot, 'legacy.1');
    await makeMedia(path.join(legacy.takeDir, 'screen.mp4'), 'video');
    group('listed project loading admits legacy take IDs but rejects directory identifiers', () => {
      assert.strictEqual(loadListedTakeProject(workRoot, legacy.takeId).takeDir, legacy.takeDir);
      for (const takeId of ['.', '..']) {
        assert.throws(() => loadListedTakeProject(workRoot, takeId), /take not found/);
      }
    });

    const real = copyRealTakeIfAvailable(workRoot);
    if (real) {
      group('optional real take copy loads without mutating the original', () => {
        const loaded = loadTakeProject(real.takeDir, real.takeId);
        assert.strictEqual(loaded.takeDir, real.takeDir);
        assert.strictEqual(loaded.project.schemaVersion, 2);
      });
    }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, cases }));
}

if (process.argv.includes('--self-test-missing-ffmpeg')) {
  const result = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, FFMPEG_PATH: '/definitely/missing/ffmpeg', FFPROBE_PATH: '/definitely/missing/ffprobe' },
    encoding: 'utf8',
  });
  assert.notStrictEqual(result.status, 0);
  console.log('smoke-load-take: missing ffmpeg self-test OK');
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
