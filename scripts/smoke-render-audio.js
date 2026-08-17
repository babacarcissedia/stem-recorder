#!/usr/bin/env node
'use strict';

/**
 * Render-audio smoke (V1-Audio / G3). The take shape the recorder now
 * produces is screen picture-only + cam muxed with the mic + audio.mp3 as
 * the standalone mic stem, so a planner that assumes input 0 carries the
 * audio renders silence. Synthetic ffmpeg fixtures do not reproduce that,
 * so the media cases build their fixture from a real take under
 * STEM_OUT_ROOT (default ~/Movies/stem-recorder) and skip when absent.
 * Nothing is written back to the take directory.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveAudioRoute } = require('../lib/domain/source.ts');
const {
  applyClips, probeHasAudio, findFfmpeg, findFfprobe,
} = require('../lib/node/ffmpeg-util.js');

let cases = 0;

function source(id, label, kind, hasAudio, present = true) {
  return { id, path: `/takes/${label}`, label, kind, hasAudio, present, availableDuration: 0, origin: 'capture', peaksKey: null };
}

{
  const screen = source('s', 'screen.mp4', 'video', false);
  const cam = source('c', 'cam.mp4', 'video', true);
  const mic = source('m', 'audio.mp3', 'audio', true);
  assert.strictEqual(resolveAudioRoute([screen, cam, mic]), 'c');
  cases += 1;

  assert.strictEqual(resolveAudioRoute([screen, mic]), 'm');
  cases += 1;

  assert.strictEqual(resolveAudioRoute([screen]), null);
  cases += 1;

  const audibleScreen = source('s', 'screen.mp4', 'video', true);
  assert.strictEqual(resolveAudioRoute([audibleScreen, mic]), 's');
  cases += 1;

  const absentCam = source('c', 'cam.mp4', 'video', true, false);
  assert.strictEqual(resolveAudioRoute([screen, absentCam, mic]), 'm');
  cases += 1;
}

const takeRoot = process.env.STEM_OUT_ROOT || path.join(os.homedir(), 'Movies', 'stem-recorder');
const ffmpeg = findFfmpeg();
const ffprobe = findFfprobe();

function findTake() {
  if (!ffmpeg || !ffprobe || !fs.existsSync(takeRoot)) return null;
  for (const entry of fs.readdirSync(takeRoot).sort()) {
    const dir = path.join(takeRoot, entry);
    const screen = path.join(dir, 'screen.mp4');
    const cam = path.join(dir, 'cam.mp4');
    const mic = path.join(dir, 'audio.mp3');
    if (!fs.existsSync(screen) || !fs.existsSync(cam) || !fs.existsSync(mic)) continue;
    if (!probeHasAudio(cam)) continue;
    return { dir, screen, cam, mic };
  }
  return null;
}

function run(args) {
  const result = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status !== 0) throw new Error(`fixture ffmpeg failed: ${String(result.stderr).slice(-400)}`);
}

async function mediaCases(take) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-render-audio-'));
  const screen = path.join(tmp, 'screen.mp4');
  const cam = path.join(tmp, 'cam.mp4');
  const mic = path.join(tmp, 'audio.mp3');

  run(['-hide_banner', '-y', '-ss', '5', '-t', '2', '-i', take.screen, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', screen]);
  run(['-hide_banner', '-y', '-ss', '5', '-t', '2', '-i', take.cam, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', cam]);
  run(['-hide_banner', '-y', '-ss', '5', '-t', '2', '-i', take.mic, '-c:a', 'libmp3lame', mic]);

  assert.strictEqual(probeHasAudio(screen), false, 'fixture screen must be picture-only');
  assert.strictEqual(probeHasAudio(cam), true, 'fixture cam must carry the mic');

  const clips = [{ id: 'a', source: 'screen.mp4', in: 0, out: 1.5 }];

  async function render(name, opts) {
    const out = path.join(tmp, name);
    const work = path.join(tmp, `work-${name}`);
    await applyClips(screen, clips, out, work, opts);
    return out;
  }

  const pip = await render('pip.mp4', {
    cam: { path: cam, mirror: false, rotate: 0, layout: null },
    stems: { cam, mic },
  });
  assert.strictEqual(probeHasAudio(pip), true, 'PiP render must carry the cam audio');
  cases += 1;

  const flat = await render('flat.mp4', { stems: { cam, mic } });
  assert.strictEqual(probeHasAudio(flat), true, 'non-PiP render must carry the cam audio');
  cases += 1;

  const micOnly = await render('mic-only.mp4', { stems: { cam: null, mic } });
  assert.strictEqual(probeHasAudio(micOnly), true, 'mic stem must be routed when no video is audible');
  cases += 1;

  const silent = await render('silent.mp4', { stems: { cam: null, mic: null } });
  assert.strictEqual(probeHasAudio(silent), false, 'nothing audible must stay silent');
  cases += 1;

  const multi = path.join(tmp, 'multi.mp4');
  await applyClips(screen, [
    { id: 'a', source: 'screen.mp4', in: 0, out: 0.8 },
    { id: 'b', source: 'screen.mp4', in: 1, out: 1.8 },
  ], multi, path.join(tmp, 'work-multi'), { stems: { cam, mic } });
  assert.strictEqual(probeHasAudio(multi), true, 'concat render must carry the cam audio');
  cases += 1;

  fs.rmSync(tmp, { recursive: true, force: true });
}

(async () => {
  const take = findTake();
  if (!take) {
    console.log(JSON.stringify({ ok: true, cases, skipped: `no take with an audible cam stem under ${takeRoot}` }));
    return;
  }
  await mediaCases(take);
  console.log(JSON.stringify({ ok: true, cases }));
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
