#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const { Project } = require('../lib/domain/project.ts');
const timelineProject = require('../src/renderer/src/components/timeline/use-timeline-project.ts');

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

function mockProjectJson() {
  return {
    schemaVersion: 2,
    timeline: {
      takeId: 'take-review',
      timebase: { unit: 'ms' },
      sources: {
        'src-screen': {
          path: 'screen.mp4',
          label: 'Screen capture',
          kind: 'video',
          availableDuration: 6_000,
          hasAudio: true,
          present: true,
          origin: 'capture',
          peaksKey: null,
        },
        'src-missing': {
          path: 'camera.mp4',
          label: 'Missing camera',
          kind: 'video',
          availableDuration: 6_000,
          hasAudio: false,
          present: false,
          origin: 'capture',
          peaksKey: null,
        },
      },
      tracks: [
        {
          id: 'trk-screen',
          kind: 'video',
          name: 'Screen track',
          clips: [{
            id: 'clip-screen',
            sourceId: 'src-screen',
            timelineStart: 0,
            duration: 2_000,
            sourceIn: 0,
            label: 'Intro screen',
          }],
        },
        {
          id: 'trk-missing',
          kind: 'video',
          name: 'Missing track',
          clips: [{
            id: 'clip-missing',
            sourceId: 'src-missing',
            timelineStart: 2_200,
            duration: 1_000,
            sourceIn: 0,
          }],
        },
      ],
      markers: [],
    },
    outputs: [],
    audioRoute: { activeSourceId: 'src-screen', resolvedBy: 'auto' },
  };
}

function readyLoadedProject(overrides = {}) {
  return {
    takeId: 'take-review',
    missingSources: [],
    project: mockProjectJson(),
    ...overrides,
  };
}

group('timeline project hook loads through the preload bridge only', () => {
  const source = read('src/renderer/src/components/timeline/use-timeline-project.ts');
  assert.match(source, /window\.stemStudio/);
  assert.match(source, /\.listTakes\(\)/);
  assert.match(source, /\.loadProject\(take\.id\)/);
  assert.match(source, /Project\.fromJSON\(loaded\.project\)/);
  assert.match(source, /hydrateLoadedTimelineProject\(loaded\)/);
  assert.doesNotMatch(source, /lib\/node/);
  assert.doesNotMatch(source, /\bfs\b|\bpath\b/);
});

group('timeline error copy is stable and never exposes raw exception text', () => {
  const raw = 'ENOENT /private/take/manifest.json bridge stack loadProject failed';
  const copy = timelineProject.timelineErrorMessage(new Error(raw));
  assert.strictEqual(copy, 'Timeline data is unavailable. Reopen the current take and try again.');
  assert.ok(!copy.includes('ENOENT'));
  assert.ok(!copy.includes('bridge'));
  assert.ok(!copy.includes('loadProject'));

  const hook = read('src/renderer/src/components/timeline/use-timeline-project.ts');
  const panel = read('src/renderer/src/components/timeline/timeline-panel.tsx');
  assert.match(hook, /message: timelineErrorMessage\(\)/);
  assert.match(panel, /timelineErrorMessage\(\)/);
  assert.doesNotMatch(panel, /\{state\.message\}/);
});

group('timeline footer labels are generated from timeline state', () => {
  const ready = timelineProject.hydrateLoadedTimelineProject(readyLoadedProject());
  assert.strictEqual(timelineProject.timelineProjectLabel(ready), 'take-review');
  assert.strictEqual(timelineProject.timelineProjectLabel({ ...ready, project: Project.fromJSON({
    ...mockProjectJson(),
    timeline: { ...mockProjectJson().timeline, takeId: '' },
  }) }), 'take-review');
  assert.strictEqual(timelineProject.timelineProjectLabel({ status: 'loading' }), 'Loading');
  assert.strictEqual(timelineProject.timelineProjectLabel({ status: 'empty' }), 'No take');
  assert.strictEqual(
    timelineProject.timelineProjectLabel({ status: 'error', message: 'raw bridge failure' }),
    'Timeline unavailable',
  );

  const footer = read('src/renderer/src/components/timeline/timeline-footer.tsx');
  assert.match(footer, /timelineProjectLabel\(timelineProject\)/);
});

group('timeline resize keyboard behavior clamps to min max and step values', () => {
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'ArrowUp', 1_000), 276);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'ArrowDown', 1_000), 244);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(185, 'ArrowDown', 1_000), 180);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'End', 400), 260);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'End', 200), 180);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'Home', 1_000), 180);
  assert.strictEqual(timelineProject.keyboardTimelineDockHeight(260, 'PageUp', 1_000), null);
  assert.strictEqual(timelineProject.timelineDockHeightValueText(260), '260 pixels');

  const footer = read('src/renderer/src/components/timeline/timeline-footer.tsx');
  assert.match(footer, /keyboardTimelineDockHeight\(height, event\.key, window\.innerHeight\)/);
  assert.match(footer, /aria-valuetext=\{timelineDockHeightValueText\(dockHeight\)\}/);
});

group('loaded payloads derive missing-source state and hydrate Project instances', () => {
  const loaded = timelineProject.loadedTakeProject(readyLoadedProject({
    missingSources: ['camera.mp4'],
  }));
  assert.strictEqual(timelineProject.loadedTimelineStatus(loaded), 'missing-source');

  const state = timelineProject.hydrateLoadedTimelineProject(loaded);
  assert.strictEqual(state.status, 'missing-source');
  assert.ok(state.project instanceof Project);
  assert.strictEqual(state.project.timeline.takeId, 'take-review');
  assert.strictEqual(state.project.timeline.trackCount, 2);
  assert.strictEqual(state.project.timeline.tracks[0].clips[0].id, 'clip-screen');
  assert.strictEqual(state.project.timeline.source('src-missing').present, false);
});

group('timeline panel renders hydrated track clip and source data', () => {
  const state = timelineProject.hydrateLoadedTimelineProject(readyLoadedProject());
  assert.strictEqual(state.project.timeline.tracks[0].name, 'Screen track');
  assert.strictEqual(state.project.timeline.tracks[0].clips[0].label, 'Intro screen');
  assert.strictEqual(state.project.timeline.tracks[1].name, 'Missing track');
  assert.strictEqual(state.project.timeline.source('src-missing').label, 'Missing camera');

  const panel = read('src/renderer/src/components/timeline/timeline-panel.tsx');
  const trackRow = read('src/renderer/src/components/timeline/timeline-track-row.tsx');
  const clip = read('src/renderer/src/components/timeline/timeline-clip.tsx');
  assert.match(panel, /timeline\.tracks\.map\(\(track\) =>/);
  assert.match(panel, /sources=\{timeline\.sources\}/);
  assert.match(trackRow, /<strong>\{track\.name\}<\/strong>/);
  assert.match(trackRow, /source=\{sources\.get\(clip\.sourceId\) \?\? null\}/);
  assert.match(clip, /clip\.label \|\| source\?\.label \|\| source\?\.path \|\| clip\.id/);
  assert.match(clip, /data-present=\{source\?\.present === false \? 'false' : 'true'\}/);
});

group('timeline panel exposes the required read-only states', () => {
  const missing = timelineProject.hydrateLoadedTimelineProject(readyLoadedProject({
    missingSources: ['camera.mp4'],
  }));
  assert.strictEqual(missing.status, 'missing-source');

  const source = read('src/renderer/src/components/timeline/timeline-panel.tsx');
  for (const expected of ['Loading the current take.', 'No takes found', 'This take has no clips', 'Missing source:', 'Timeline unavailable']) {
    assert.ok(source.includes(expected), `${expected} state should be rendered`);
  }
  assert.match(source, /data-state=\{state\.status\}/);
  assert.match(source, /state\.loadedProject\.missingSources\.join\(', '\)/);
  assert.match(source, /aria-label=\{`Read-only timeline for/);
});

group('timeline footer no longer ships the placeholder preview labels', () => {
  const source = read('src/renderer/src/components/timeline/timeline-footer.tsx');
  for (const placeholder of ['0:15', 'Video 1', 'Current take']) {
    assert.ok(!source.includes(placeholder), `${placeholder} placeholder should not remain`);
  }
  assert.match(source, /TimelinePanel/);
  assert.ok(source.includes('Save in Studio editor'));
});

group('timeline dock is bounded and lane overflow is internal', () => {
  const html = read('src/renderer/index.html');
  const shell = read('src/renderer/src/app-shell.css');
  const panel = read('src/renderer/src/components/timeline/timeline-panel.css');
  assert.match(html, /html, body \{[\s\S]*?height: 100%; overflow: hidden;/);
  assert.match(html, /#app-shell-root \{[\s\S]*?height: 100%; min-height: 0;/);
  assert.match(html, /#legacy-studio-root \{[\s\S]*?padding: var\(--space-16\)/);
  assert.match(shell, /\.shell-route \{[\s\S]*?overflow: hidden;/);
  assert.match(shell, /\.legacy-studio-host \{[\s\S]*?min-height: 0;[\s\S]*?overflow: auto;/);
  assert.match(shell, /\.shell-footer \{[\s\S]*?overflow: hidden;/);
  assert.match(shell, /grid-template-rows: minmax\(0, 1fr\) minmax\(var\(--size-preview-min\), auto\);/);
  assert.match(panel, /\.react-timeline-viewport \{[\s\S]*?overflow: auto;/);
});

group('timeline resize separator supports keyboard and accessible range metadata', () => {
  const footer = read('src/renderer/src/components/timeline/timeline-footer.tsx');
  const shell = read('src/renderer/src/app-shell.css');
  assert.match(read('src/renderer/src/components/timeline/use-timeline-project.ts'), /case 'ArrowUp':[\s\S]*case 'ArrowDown':[\s\S]*case 'Home':[\s\S]*case 'End':/);
  assert.match(footer, /aria-valuemax=\{dockMax\}/);
  assert.match(footer, /aria-valuetext=\{timelineDockHeightValueText\(dockHeight\)\}/);
  assert.match(footer, /onKeyDown=\{resizeWithKeyboard\}/);
  assert.match(footer, /keyboardTimelineDockHeight/);
  assert.match(shell, /\.shell-footer-resize:focus-visible \{[\s\S]*?outline: var\(--border-thick\) solid var\(--accent\);/);
});

group('timeline ruler and playhead share the track origin', () => {
  const panel = read('src/renderer/src/components/timeline/timeline-panel.css');
  assert.match(panel, /--react-timeline-track-start: calc\(var\(--size-lane-gutter\) \+ var\(--space-4\)\);/);
  assert.match(panel, /\.react-timeline-ruler \{[\s\S]*?margin-inline-start: var\(--react-timeline-track-start\);/);
  assert.match(panel, /\.react-timeline-playhead \{[\s\S]*?margin-inline-start: var\(--react-timeline-track-start\);/);
});

group('react timeline smoke is wired into package scripts and preflight', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['smoke:react-timeline'], 'node scripts/smoke-react-timeline.js');
  assert.match(read('scripts/preflight.js'), /smoke:react-timeline/);
});

console.log(JSON.stringify({ ok: true, cases }));
