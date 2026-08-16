#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Edit-T1 apply (no Electron window).
 * Usage: STEM_OUT_ROOT=/tmp/stem-test-takes node scripts/smoke-apply.js take-demo
 */
const path = require('path');
const fs = require('fs');

// Minimal electron app stub so lib/paths can load without Electron when testing apply only
process.env.STEM_OUT_ROOT = process.env.STEM_OUT_ROOT || '/tmp/stem-test-takes';

const {
  applyClips, probeDuration, probeDimensions, probeHasAudio, findFfmpeg, runFfmpeg, hasSubtitlesFilter,
  verifyOutputDuration,
} = require('../lib/ffmpeg-util');
const { expectedOutputDuration, durationTolerance } = require('../lib/apply-duration');
const { writeManifest, readManifest, FINAL_NAME } = require('../lib/edit-manifest');

async function main() {
  const takeId = process.argv[2] || 'take-demo';
  const { takeDir, duration, manifest } = readManifest(takeId);
  // Trim middle 2s of an 8s synthetic take: 2 → 6
  const doc = {
    ...manifest,
    clips: [{ id: 'clip-1', source: 'screen.mp4', in: 2, out: 6 }],
  };
  writeManifest(takeId, doc);
  const src = path.join(takeDir, 'screen.mp4');
  const out = path.join(takeDir, FINAL_NAME);
  const work = path.join(takeDir, 'edit', '.work');
  fs.mkdirSync(work, { recursive: true });
  await applyClips(src, doc.clips, out, work);
  const dur = probeDuration(out);
  const trimOk = dur != null && Math.abs(dur - 4) < 0.35;

  // I.3: crop to the center quarter — manifest round-trip must keep the rect,
  // the export must come out at half the source dimensions (even-floored).
  const crop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  writeManifest(takeId, { ...doc, clips: doc.clips.map((c) => ({ ...c, crop })) });
  const reread = readManifest(takeId).manifest;
  const cropKept = JSON.stringify(reread.clips[0].crop) === JSON.stringify(crop);
  const cropOut = path.join(takeDir, 'edit', 'final-crop.mp4');
  await applyClips(src, reread.clips, cropOut, work);
  const srcDim = probeDimensions(src);
  const outDim = probeDimensions(cropOut);
  const cropOk = Boolean(srcDim && outDim)
    && outDim.width === Math.floor((srcDim.width * crop.w) / 2) * 2
    && outDim.height === Math.floor((srcDim.height * crop.h) / 2) * 2;

  // Edit-T2a: cam PiP overlay (mirror + rotate on the cam input) must keep
  // the base dimensions and the trimmed duration. Synthesize a cam stem when
  // the fixture take has none.
  const camSrc = path.join(takeDir, 'cam.mp4');
  if (!fs.existsSync(camSrc)) {
    await runFfmpeg(findFfmpeg(), [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=8',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      camSrc,
    ]);
  }
  const pipOut = path.join(takeDir, 'edit', 'final-pip.mp4');
  await applyClips(src, doc.clips, pipOut, work, {
    cam: { path: camSrc, mirror: true, rotate: 90 },
  });
  const pipDim = probeDimensions(pipOut);
  const pipDur = probeDuration(pipOut);
  const pipOk = Boolean(srcDim && pipDim)
    && pipDim.width === srcDim.width
    && pipDim.height === srcDim.height
    && pipDur != null && Math.abs(pipDur - 4) < 0.35;

  // Edit-T2c: a 1.5s freeze after the [2,6] trim must stretch the export to
  // ≈5.5s at unchanged dimensions — screen-only and composed with cam PiP.
  const freezeClips = [
    { id: 'clip-1', source: 'screen.mp4', in: 2, out: 6 },
    { id: 'clip-f', source: 'screen.mp4', in: 6, out: 7.5, freeze: true },
  ];
  const freezeOut = path.join(takeDir, 'edit', 'final-freeze.mp4');
  await applyClips(src, freezeClips, freezeOut, work);
  const frzDim = probeDimensions(freezeOut);
  const frzDur = probeDuration(freezeOut);
  const freezePipOut = path.join(takeDir, 'edit', 'final-freeze-pip.mp4');
  await applyClips(src, freezeClips, freezePipOut, work, {
    cam: { path: camSrc, mirror: true, rotate: 90 },
  });
  const frzPipDim = probeDimensions(freezePipOut);
  const frzPipDur = probeDuration(freezePipOut);
  const freezeOk = Boolean(srcDim && frzDim && frzPipDim)
    && frzDim.width === srcDim.width && frzDim.height === srcDim.height
    && frzDur != null && Math.abs(frzDur - 5.5) < 0.4
    && frzPipDim.width === srcDim.width && frzPipDim.height === srcDim.height
    && frzPipDur != null && Math.abs(frzPipDur - 5.5) < 0.4;

  // Edit-T2d: burning a VTT must keep duration + dimensions (cues render on
  // the frame, not around it). Auto-skips on ffmpeg builds without libass.
  let captionsOk = true;
  let captionsSkipped = null;
  let preBurnOk = true;
  let preBurnSkipped = null;
  if (hasSubtitlesFilter(findFfmpeg())) {
    const vtt = path.join(takeDir, 'edit', 'captions.vtt');
    if (!fs.existsSync(vtt)) {
      fs.writeFileSync(vtt, 'WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nSmoke cue.\n', 'utf8');
    }
    const burnOut = path.join(takeDir, 'edit', 'final-captions.mp4');
    const preBurnOut = path.join(takeDir, 'edit', 'final-no-captions.mp4');
    await applyClips(src, doc.clips, burnOut, work, { subtitles: vtt, preBurnOutPath: preBurnOut });
    const burnDim = probeDimensions(burnOut);
    const burnDur = probeDuration(burnOut);
    captionsOk = Boolean(srcDim && burnDim)
      && burnDim.width === srcDim.width && burnDim.height === srcDim.height
      && burnDur != null && Math.abs(burnDur - 4) < 0.35;

    const preBurnDim = probeDimensions(preBurnOut);
    const preBurnDur = probeDuration(preBurnOut);
    const preBurnMatchesPlainTrim = Buffer.compare(fs.readFileSync(preBurnOut), fs.readFileSync(out)) === 0;
    preBurnOk = Boolean(srcDim && preBurnDim)
      && preBurnDim.width === srcDim.width && preBurnDim.height === srcDim.height
      && preBurnDur != null && Math.abs(preBurnDur - 4) < 0.35
      && preBurnMatchesPlainTrim;

    const noSubtitlesOut = path.join(takeDir, 'edit', 'final-no-subtitles-opt.mp4');
    const preBurnIgnoredWhenNoSubtitles = path.join(takeDir, 'edit', 'final-no-captions-ignored.mp4');
    await applyClips(src, doc.clips, noSubtitlesOut, work, { preBurnOutPath: preBurnIgnoredWhenNoSubtitles });
    preBurnOk = preBurnOk && !fs.existsSync(preBurnIgnoredWhenNoSubtitles);
  } else {
    captionsSkipped = 'ffmpeg build lacks the subtitles filter (libass)';
    preBurnSkipped = captionsSkipped;
  }
  // Edit-T2e: a constant 2× export halves the [2,6] trim to ≈2s; with the
  // 1.5s freeze appended the hold shrinks by the same factor → ≈2.75s.
  const rateOut = path.join(takeDir, 'edit', 'final-rate.mp4');
  await applyClips(src, doc.clips, rateOut, work, { rate: 2 });
  const rateDur = probeDuration(rateOut);
  const rateFrzOut = path.join(takeDir, 'edit', 'final-rate-freeze.mp4');
  await applyClips(src, freezeClips, rateFrzOut, work, { rate: 2 });
  const rateFrzDur = probeDuration(rateFrzOut);
  const rateOk = rateDur != null && Math.abs(rateDur - 2) < 0.35
    && rateFrzDur != null && Math.abs(rateFrzDur - 2.75) < 0.4;

  // Edit-T2e: music bed — synthesize a short sine, mix it under the
  // (video-only) export: duration/dimensions unchanged, audio track present.
  // The 2s sine loops across the 4s export. Composes with rate.
  const musicSrc = path.join(takeDir, 'music-smoke.wav');
  if (!fs.existsSync(musicSrc)) {
    await runFfmpeg(findFfmpeg(), [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-c:a', 'pcm_s16le',
      musicSrc,
    ]);
  }
  const musicOut = path.join(takeDir, 'edit', 'final-music.mp4');
  await applyClips(src, doc.clips, musicOut, work, { music: { path: musicSrc, gainDb: -18 } });
  const musicDim = probeDimensions(musicOut);
  const musicDur = probeDuration(musicOut);
  const musicRateOut = path.join(takeDir, 'edit', 'final-music-rate.mp4');
  await applyClips(src, doc.clips, musicRateOut, work, { rate: 2, music: { path: musicSrc, gainDb: -18 } });
  const musicRateDur = probeDuration(musicRateOut);
  const musicOk = Boolean(srcDim && musicDim)
    && musicDim.width === srcDim.width && musicDim.height === srcDim.height
    && musicDur != null && Math.abs(musicDur - 4) < 0.35
    && probeHasAudio(musicOut)
    && musicRateDur != null && Math.abs(musicRateDur - 2) < 0.35
    && probeHasAudio(musicRateOut);

  // A1: expectedOutputDuration pure math — freeze (Edit-T2c) holds are
  // wall-clock and export rate (Edit-T2e) scales the whole thing by 1/rate,
  // so a [2,6] trim + a 1.5s freeze at 2x must land at (4 + 1.5) / 2 = 2.75s.
  const durationMathOk = Math.abs(expectedOutputDuration(doc.clips, {}) - 4) < 1e-9
    && Math.abs(expectedOutputDuration(freezeClips, {}) - 5.5) < 1e-9
    && Math.abs(expectedOutputDuration(doc.clips, { rate: 2 }) - 2) < 1e-9
    && Math.abs(expectedOutputDuration(freezeClips, { rate: 2 }) - 2.75) < 1e-9;

  // A1: verifyOutputDuration must pass on a correct render and FAIL LOUDLY —
  // with both the expected and actual number in the message — on a mismatch,
  // and must delete the file it flagged rather than leave it on disk.
  const mismatchProbe = path.join(takeDir, 'edit', 'mismatch-probe.mp4');
  fs.copyFileSync(out, mismatchProbe); // `out` is a real 4s render from the trim test above
  let mismatchThrew = false;
  let mismatchMessageOk = false;
  try {
    verifyOutputDuration(mismatchProbe, 40); // 4s file asserted against a wildly wrong 40s expectation
  } catch (e) {
    mismatchThrew = true;
    mismatchMessageOk = /40\.00s/.test(e.message) && /4\.00s/.test(e.message);
  }
  const mismatchDeletedFile = !fs.existsSync(mismatchProbe);
  let matchOk = true;
  try {
    verifyOutputDuration(out, 4); // same file, correct expectation — must not throw or delete
  } catch {
    matchOk = false;
  }
  const outStillThere = fs.existsSync(out);
  const durationGuardOk = durationMathOk && mismatchThrew && mismatchMessageOk && mismatchDeletedFile && matchOk && outStillThere;

  // A2: per-clip render cache. Re-running the exact same Apply must reuse
  // the cached clip-part instead of re-rendering (part count unchanged),
  // and must produce a byte-for-byte identical output — this is only safe
  // because the cache key can never collide across different render params
  // (checked next).
  const cacheDir = path.join(takeDir, 'edit', '.cache', 'clip-parts');
  const countCacheFiles = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mp4')).length : 0);
  const cacheOut1 = path.join(takeDir, 'edit', 'final-cache-1.mp4');
  await applyClips(src, doc.clips, cacheOut1, work);
  const cacheCountAfterFirst = countCacheFiles();
  const cacheOut2 = path.join(takeDir, 'edit', 'final-cache-2.mp4');
  await applyClips(src, doc.clips, cacheOut2, work);
  const cacheCountAfterSecond = countCacheFiles();
  const cacheHitOk = cacheCountAfterFirst > 0 && cacheCountAfterSecond === cacheCountAfterFirst
    && Buffer.compare(fs.readFileSync(cacheOut1), fs.readFileSync(cacheOut2)) === 0;

  // A2: a stale key can never hit — same in/out but a different rate (a
  // render-affecting param) must produce a different-duration output, not a
  // reused segment from the 1x render above (that would come out ~4s, not
  // ~2s). The rate:2 key may already be warm from the Edit-T2e section
  // above, so this checks correctness of what got served, not file count.
  const cacheOut3 = path.join(takeDir, 'edit', 'final-cache-3.mp4');
  await applyClips(src, doc.clips, cacheOut3, work, { rate: 2 });
  const cacheCountAfterRate = countCacheFiles();
  const cache3Dur = probeDuration(cacheOut3);
  const staleKeyRateOk = cache3Dur != null && Math.abs(cache3Dur - 2) < 0.35;

  // A2: touching the source file's mtime (a re-record over the same path)
  // must also miss the cache — the same clip params render again rather
  // than serving a segment from before the source changed.
  const srcStatBefore = fs.statSync(src);
  fs.utimesSync(src, new Date(), new Date(Date.now() + 5000));
  const cacheOut4 = path.join(takeDir, 'edit', 'final-cache-4.mp4');
  await applyClips(src, doc.clips, cacheOut4, work);
  const cacheCountAfterTouch = countCacheFiles();
  fs.utimesSync(src, srcStatBefore.atime, srcStatBefore.mtime); // restore, so later reruns of this smoke stay stable
  const staleKeySourceOk = cacheCountAfterTouch > cacheCountAfterRate;

  const cacheOk = cacheHitOk && staleKeyRateOk && staleKeySourceOk;

  fs.rmSync(work, { recursive: true, force: true });

  const ok = trimOk && cropKept && cropOk && pipOk && freezeOk && captionsOk && preBurnOk && rateOk && musicOk
    && durationGuardOk && cacheOk;
  console.log(JSON.stringify({
    takeId, out, expected: 4, duration: dur, trimOk,
    crop, cropKept, srcDim, outDim, cropOk,
    pipDim, pipDur, pipOk,
    frzDur, frzDim, frzPipDur, frzPipDim, freezeOk,
    captionsOk, captionsSkipped, preBurnOk, preBurnSkipped,
    rateDur, rateFrzDur, rateOk,
    musicDur, musicRateDur, musicOk,
    durationMathOk, mismatchThrew, mismatchMessageOk, mismatchDeletedFile, matchOk, outStillThere, durationGuardOk,
    cacheCountAfterFirst, cacheCountAfterSecond, cacheHitOk,
    cacheCountAfterRate, cache3Dur, staleKeyRateOk,
    cacheCountAfterTouch, staleKeySourceOk, cacheOk,
    ok,
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
