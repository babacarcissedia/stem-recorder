'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { expectedOutputDuration, durationTolerance } = require('../domain/apply-duration.ts');
const { buildKaraokeAss } = require('../domain/captions.ts');
const { buildVerticalPreset } = require('../domain/export-presets.ts');

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    'ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
      if (r.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

function findFfprobe() {
  const candidates = [
    process.env.FFPROBE_PATH,
    'ffprobe',
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
      if (r.status === 0) return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().split('\n').slice(-12).join('\n') || `ffmpeg exit ${code}`));
    });
  });
}

function probeDuration(filePath) {
  const ffprobe = findFfprobe();
  if (!ffprobe) return null;
  const r = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const n = parseFloat(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
}

function probeDimensions(filePath) {
  const ffprobe = findFfprobe();
  if (!ffprobe) return null;
  const r = spawnSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const [w, h] = String(r.stdout).trim().split(',').map((n) => parseInt(n, 10));
  return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
}

/** True when the file has at least one audio stream (false when ffprobe is missing). */
function probeHasAudio(filePath) {
  const ffprobe = findFfprobe();
  if (!ffprobe) return false;
  const r = spawnSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=codec_type',
    '-of', 'csv=p=0',
    filePath,
  ], { encoding: 'utf8' });
  return r.status === 0 && String(r.stdout).trim().length > 0;
}

/**
 * ffmpeg crop filter for a normalized { x, y, w, h } rect (0–1 of the source
 * frame). Width/height are floored to even values for yuv420p/libx264.
 */
function cropFilter(crop) {
  return [
    `crop=w=floor(iw*${crop.w}/2)*2`,
    `h=floor(ih*${crop.h}/2)*2`,
    `x=floor(iw*${crop.x})`,
    `y=floor(ih*${crop.y})`,
  ].join(':');
}

function verticalCropScaleFilter(verticalPreset) {
  const { crop, scale } = verticalPreset;
  return `crop=w=${crop.w}:h=${crop.h}:x=${crop.x}:y=${crop.y},scale=w=${scale.width}:h=${scale.height}`;
}

/** PiP layout constants (Edit-T2a): bottom-right, ~25% of base width. */
const PIP_WIDTH_FRAC = 0.25;
const PIP_MARGIN_FRAC = 0.02;
const PIP_MIN_MARGIN = 12;

/**
 * Cam-input filter steps for take-level cam settings, in ARCHITECTURE order:
 * hflip (mirror, source space) first, then the clockwise rotation
 * (90 → transpose=1, 180 → hflip,vflip, 270 → transpose=2).
 */
function camTransformFilters(cam) {
  const steps = [];
  if (cam && cam.mirror) steps.push('hflip');
  const rotate = cam ? cam.rotate : 0;
  if (rotate === 90) steps.push('transpose=1');
  else if (rotate === 180) steps.push('hflip', 'vflip');
  else if (rotate === 270) steps.push('transpose=2');
  return steps;
}

/**
 * overlay x/y for a normalized pipLayout { x, y } (0–1 of the base frame,
 * top-left corner). Clamped on-canvas as ffmpeg expressions — the PiP height
 * is only known at render time (cam aspect after rotate). No layout → the
 * Edit-T2a bottom-right margin default.
 */
function pipOverlayPosition(layout, margin) {
  if (!layout) return `x=W-w-${margin}:y=H-h-${margin}`;
  return `x='min(max(W*${layout.x},0),W-w)':y='min(max(H*${layout.y},0),H-h)'`;
}

/**
 * True when this ffmpeg build ships the subtitles filter (needs libass —
 * minimal builds omit it). Exit code is useless here: ffmpeg prints
 * "Unknown filter" and still exits 0, so match the help text instead.
 */
const subtitlesSupport = new Map();
function hasSubtitlesFilter(bin) {
  if (!subtitlesSupport.has(bin)) {
    const r = spawnSync(bin, ['-hide_banner', '-h', 'filter=subtitles'], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    subtitlesSupport.set(bin, r.status === 0 && /Filter subtitles/.test(out));
  }
  return subtitlesSupport.get(bin);
}

/**
 * subtitles= filter for a caption file (Edit-T2d burn-in). The path is a
 * filter argument, so escape libavfilter's specials (\ ' :) and quote the
 * value so commas/semicolons in the path survive the graph parser.
 */
function subtitlesFilter(subPath) {
  const escaped = String(subPath)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:');
  return `subtitles=filename='${escaped}'`;
}

function resolveCaptionsPath(editDir, styleOptions = {}) {
  const asrPath = path.join(editDir, 'asr.json');
  const vttPath = path.join(editDir, 'captions.vtt');
  if (fs.existsSync(asrPath)) {
    let words = null;
    try {
      const asr = JSON.parse(fs.readFileSync(asrPath, 'utf8'));
      if (Array.isArray(asr.words) && asr.words.length) words = asr.words;
    } catch {
      words = null;
    }
    if (words) {
      const cacheDir = path.join(editDir, '.cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const assPath = path.join(cacheDir, 'captions-karaoke.ass');
      fs.writeFileSync(assPath, buildKaraokeAss(words, styleOptions), 'utf8');
      return assPath;
    }
  }
  return fs.existsSync(vttPath) ? vttPath : null;
}

/** Video side of a constant export speed (Edit-T2e): rate 2 → half the PTS. */
function speedVideoFilter(rate) {
  return `setpts=PTS/${rate}`;
}

/**
 * Audio side of a constant export speed: one atempo per factor, each within
 * the filter's 0.5–2 range (2.5× → atempo=2,atempo=1.25). Rates the manifest
 * allows (0.25–4) always decompose into at most two steps. 1× → [].
 */
function atempoChain(rate) {
  const steps = [];
  let rest = rate;
  while (rest > 2) { steps.push(2); rest /= 2; }
  while (rest < 0.5) { steps.push(0.5); rest /= 0.5; }
  if (Math.abs(rest - 1) > 1e-9) steps.push(Math.round(rest * 1e6) / 1e6);
  return steps.map((s) => `atempo=${s}`);
}

function buildMediaInputPlan({ srcPath, dialoguePath = null, camPath = null }) {
  const inputArgs = ['-i', srcPath];
  const dialogueInputIndex = dialoguePath ? inputArgs.length / 2 : null;
  if (dialoguePath) inputArgs.push('-i', dialoguePath);
  const camInputIndex = camPath ? inputArgs.length / 2 : null;
  if (camPath) inputArgs.push('-i', camPath);
  return Object.freeze({
    inputArgs,
    dialogueInputIndex,
    camInputIndex,
    audioMapArgs: dialogueInputIndex == null ? ['-an'] : ['-map', `${dialogueInputIndex}:a:0`],
  });
}

/**
 * -filter_complex mixing the music bed (input 1) under the export's audio
 * (Edit-T2e). Base with dialogue → volume-duck the bed, amix with
 * duration=first + normalize=0 so the dialogue level is untouched and the
 * mix ends with it. Video-only base (recorded stems) → the ducked bed IS the
 * audio track. Output label: [a].
 */
function musicMixGraph({ gainDb, baseHasAudio }) {
  const bed = `[1:a]volume=${gainDb}dB`;
  if (!baseHasAudio) return `${bed}[a]`;
  return `${bed}[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[a]`;
}

/**
 * Filter chain turning the first decoded frame into a still of durationSec
 * (Edit-T2c freeze): keep frame 0 — the input is seeked to the frozen
 * frame — re-zero its PTS, then tpad-clone it. Composes after crop
 * (screen-only Apply) or after the PiP overlay.
 */
function freezeStillChain(durationSec) {
  return `trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${durationSec}`;
}

/**
 * -filter_complex graph overlaying the cam (input 1) on the screen
 * (input 0) at the persisted pipLayout (default bottom-right). crop applies
 * to the screen base only; the cam chain is mirror → rotate → scale to
 * pipWidth (aspect kept, even height). Output label: [v].
 *
 * freezeDur (Edit-T2c) appends a held-still stage after the overlay so a
 * freeze segment composes with crop + PiP; absent, the graph is unchanged.
 *
 * subtitlesPath (Edit-T2d) appends a caption burn-in stage after crop,
 * overlay and freeze, so cues draw on the composed frame.
 *
 * rate (Edit-T2e) appends the constant-speed setpts stage last — after the
 * caption burn, which reads source-timeline PTS to place cues; speeding up
 * first would shift every cue.
 */
function pipFilterGraph({
  crop, cam, pipWidth, margin, layout, freezeDur, subtitlesPath, rate, verticalPreset, camInputIndex = 1,
}) {
  const baseStages = [
    crop ? cropFilter(crop) : null,
    verticalPreset ? verticalCropScaleFilter(verticalPreset) : null,
  ].filter(Boolean);
  const base = baseStages.length ? `[0:v]${baseStages.join(',')}[base]` : '[0:v]null[base]';
  const camSteps = [
    ...camTransformFilters(cam),
    `scale=w=${verticalPreset ? verticalPreset.pip.w : pipWidth}:h=-2`,
  ];
  const stages = [];
  if (freezeDur) stages.push(freezeStillChain(freezeDur));
  if (subtitlesPath) stages.push(subtitlesFilter(subtitlesPath));
  if (rate && rate !== 1) stages.push(speedVideoFilter(rate));
  const overlayPosition = verticalPreset
    ? `x=${verticalPreset.pip.x}:y=${verticalPreset.pip.y}`
    : pipOverlayPosition(layout, margin);
  const lines = [
    base,
    `[${camInputIndex}:v]${camSteps.join(',')}[pip]`,
    `[base][pip]overlay=${overlayPosition}${stages.length ? '[ov]' : '[v]'}`,
  ];
  if (stages.length) lines.push(`[ov]${stages.join(',')}[v]`);
  return lines.join(';');
}

/**
 * Guards the failure this lane exists for: ffmpeg can exit 0 having produced
 * a file whose real duration doesn't match what the edit model expects
 * (mis-measured segment counts, a truncated concat, a bad atempo chain).
 * Probes the rendered file and throws with BOTH numbers rather than leaving
 * an unverified or wrong file at outPath for the caller to trust. A missing
 * ffprobe means "cannot verify", which this treats the same as a mismatch —
 * silently skipping the check is the exact bug this exists to close.
 */
function verifyOutputDuration(outPath, expectedSec) {
  const actualSec = probeDuration(outPath);
  if (actualSec == null) {
    fs.rmSync(outPath, { force: true });
    throw new Error(
      `Apply duration check failed: could not probe ${outPath} (ffprobe missing or output unreadable) — `
      + `expected ${expectedSec.toFixed(2)}s from the edit manifest. Deleted the output rather than leave it unverified.`
    );
  }
  const tolerance = durationTolerance(expectedSec);
  if (Math.abs(actualSec - expectedSec) > tolerance) {
    fs.rmSync(outPath, { force: true });
    throw new Error(
      `Apply produced a wrong-duration output: expected ${expectedSec.toFixed(2)}s from the edit manifest, `
      + `got ${actualSec.toFixed(2)}s (tolerance ${tolerance.toFixed(2)}s). `
      + `Deleted ${outPath} rather than leave a silently wrong file on disk.`
    );
  }
}

/** Seek slightly before a freeze frame so a frame at the exact clip end still decodes. */
const FREEZE_SEEK_BACKOFF = 0.05;

function fileStamp(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function freezeArgs(plan, clip) {
  const start = Number(clip.in) || 0;
  const sourceDuration = Number(clip.out) - start;
  if (!(sourceDuration > 0)) throw new Error('freeze segment needs a positive duration');
  const holdDuration = plan.rate ? Math.round((sourceDuration / plan.rate) * 1000) / 1000 : sourceDuration;
  const seekTo = Math.max(0, start - FREEZE_SEEK_BACKOFF);
  const args = ['-hide_banner', '-y', '-ss', String(seekTo), '-i', plan.srcPath];
  if (plan.cam) {
    const camSeek = plan.camDur != null ? Math.min(seekTo, Math.max(0, plan.camDur - 0.2)) : seekTo;
    args.push('-ss', String(camSeek), '-i', plan.cam.path);
  }
  if (plan.withSilence) {
    args.push('-f', 'lavfi', '-t', String(holdDuration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  }
  if (plan.cam) {
    args.push(
      '-filter_complex',
      pipFilterGraph({
        crop: plan.crop, cam: plan.cam, ...plan.pip, freezeDur: holdDuration, verticalPreset: plan.verticalPreset,
      }),
      '-map', '[v]'
    );
    if (plan.withSilence) args.push('-map', '2:a');
  } else {
    args.push('-vf', [
      plan.crop ? cropFilter(plan.crop) : null,
      plan.verticalPreset ? verticalCropScaleFilter(plan.verticalPreset) : null,
      freezeStillChain(holdDuration),
    ].filter(Boolean).join(','), '-map', '0:v:0');
    if (plan.withSilence) args.push('-map', '1:a:0');
  }
  if (!plan.withSilence) args.push('-an');
  args.push('-t', String(holdDuration), ...plan.encodeArgs);
  return args;
}

function clipArgs(plan, clip) {
  if (clip.freeze) return freezeArgs(plan, clip);
  const args = ['-hide_banner', '-y', ...plan.inputArgs, '-ss', String(clip.in)];
  if (clip.out != null) args.push('-to', String(clip.out));
  args.push(...plan.filterArgs, ...plan.encodeArgs);
  return args;
}

function clipCacheKey(plan, clip) {
  const isFreeze = !!clip.freeze;
  const payload = {
    in: clip.in,
    out: clip.out,
    freeze: isFreeze,
    crop: plan.crop || null,
    subtitles: !isFreeze && plan.subtitles ? { path: plan.subtitles, stamp: plan.subtitlesStamp } : null,
    cam: plan.cam ? {
      path: plan.cam.path,
      stamp: plan.camStamp,
      mirror: !!plan.cam.mirror,
      rotate: plan.cam.rotate || 0,
      layout: plan.cam.layout || null,
    } : null,
    rate: plan.rate || null,
    dialogue: plan.dialogue ? { path: plan.dialogue.path, stamp: plan.dialogueStamp } : null,
    verticalPreset: plan.verticalPreset || null,
    srcStamp: plan.srcStamp,
  };
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Accurate trim/concat. clips = [{ in, out|null, crop?, freeze? }, ...]
 * crop is one rect per take for now: mismatched per-clip crops would produce
 * mixed-dimension parts the stream-copy concat cannot join (per-clip crop =
 * Edit-T2), so they are rejected up front.
 *
 * opts.cam = { path, mirror, rotate, layout } adds the cam stem as a PiP
 * overlay (Edit-T2a/T2b) — layout is the normalized { x, y, w } rect
 * (default bottom-right when null). Both inputs share the recording
 * timeline (linked stems), so the output-side -ss/-to trim keeps them in
 * sync.
 *
 * freeze clips (Edit-T2c) render as held stills: input-seek to just before
 * the frozen frame (an output-side seek would let trim grab frame 0 of the
 * whole file), keep one frame, tpad-clone it for the segment duration.
 * Audio: anullsrc silence when the source has audio so concat streams keep
 * matching, else none (recorded stems are video-only).
 *
 * opts.subtitles (Edit-T2d) burns a caption file into every trimmed clip.
 * Clips seek output-side (-ss after -i), so the subtitles filter sees
 * source-timeline PTS and cues land at their recorded times with no
 * re-timing. Freeze clips skip the burn: they input-seek (PTS re-zeroed)
 * and carry silence, so no cue belongs on them.
 *
 * opts.rate (Edit-T2e) renders the whole export at a constant speed:
 * setpts (after any caption burn) + an atempo chain on every trimmed clip,
 * so the parts the stream-copy concat joins already carry the sped timing.
 * Freeze holds shrink/stretch by the same factor (their duration is
 * wall-clock, not source range) — matching a preview played at that rate.
 *
 * opts.music (Edit-T2e) = { path, gainDb } mixes a music bed under the
 * export in a final pass over the concat result (video stream copied):
 * bed ducked to gainDb, looped to cover the export, mix ends with the
 * export. The bed is not affected by opts.rate — it scores the final
 * timeline.
 */
async function applyClips(srcPath, clips, outPath, workDir, opts = {}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found on PATH');
  fs.mkdirSync(workDir, { recursive: true });

  const crops = clips.map((c) => c.crop || null);
  const first = crops.find(Boolean) || null;
  if (first && crops.some((c) => !c || c.x !== first.x || c.y !== first.y || c.w !== first.w || c.h !== first.h)) {
    throw new Error('clips have different crop rects — one crop per take for now');
  }

  const encodeArgs = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    '-c:a', 'aac',
    '-movflags', '+faststart',
  ];

  const cam = opts.cam || null;
  if (opts.dialoguePath != null && typeof opts.dialoguePath !== 'string') {
    throw new Error('selected dialogue source path must be a string');
  }
  const dialoguePath = opts.dialoguePath || null;
  if (dialoguePath && !fs.existsSync(dialoguePath)) {
    throw new Error(`selected dialogue source is missing: ${dialoguePath}`);
  }
  if (dialoguePath && !probeHasAudio(dialoguePath)) {
    throw new Error(`selected dialogue source has no audio stream: ${dialoguePath}`);
  }
  const mediaInput = buildMediaInputPlan({
    srcPath,
    dialoguePath,
    camPath: cam ? cam.path : null,
  });
  const dialogue = dialoguePath ? { path: dialoguePath } : null;
  const rate = opts.rate && opts.rate !== 1 ? Number(opts.rate) : null;
  const music = opts.music || null;
  const vertical = opts.vertical || null;

  let dim = null;
  if (cam || vertical) {
    dim = probeDimensions(srcPath);
    if (!dim) throw new Error('cannot probe screen dimensions for cam PiP / vertical export');
  }
  const baseWidth = dim ? (first ? Math.floor((dim.width * first.w) / 2) * 2 : dim.width) : null;
  const baseHeight = dim ? (first ? Math.floor((dim.height * first.h) / 2) * 2 : dim.height) : null;

  let verticalPreset = null;
  if (vertical) {
    const camDim = cam ? probeDimensions(cam.path) : null;
    verticalPreset = buildVerticalPreset({
      source: { width: baseWidth, height: baseHeight },
      target: vertical.target,
      cam: camDim,
      pip: vertical.pip || {},
    });
  }

  const hasFreeze = clips.some((c) => c.freeze);
  const withSilence = hasFreeze && mediaInput.dialogueInputIndex != null;
  const camDur = hasFreeze && cam ? probeDuration(cam.path) : null;

  const cacheDir = path.join(workDir, '..', '.cache', 'clip-parts');
  const fallbackDuration = clips.some((c) => c.out == null) ? probeDuration(srcPath) : null;
  const expectedSec = expectedOutputDuration(clips, { rate, fallbackDuration });
  const srcStamp = fileStamp(srcPath);
  const dialogueStamp = dialogue ? fileStamp(dialogue.path) : null;
  const camStamp = cam ? fileStamp(cam.path) : null;

  function buildPlan(subtitles) {
    const inputArgs = mediaInput.inputArgs;
    const vf = [
      first ? cropFilter(first) : null,
      verticalPreset ? verticalCropScaleFilter(verticalPreset) : null,
      subtitles ? subtitlesFilter(subtitles) : null,
      rate ? speedVideoFilter(rate) : null,
    ].filter(Boolean);
    let filterArgs = [
      ...(vf.length ? ['-vf', vf.join(',')] : []),
      '-map', '0:v:0',
      ...mediaInput.audioMapArgs,
    ];

    let pip = null;
    if (cam) {
      const layout = cam.layout || null;
      const widthFrac = layout ? layout.w : PIP_WIDTH_FRAC;
      pip = {
        layout,
        pipWidth: verticalPreset ? verticalPreset.pip.w : Math.max(2, Math.floor((baseWidth * widthFrac) / 2) * 2),
        margin: Math.max(PIP_MIN_MARGIN, Math.round(baseWidth * PIP_MARGIN_FRAC)),
      };
      filterArgs = [
        '-filter_complex', pipFilterGraph({
          crop: first, cam, ...pip, subtitlesPath: subtitles, rate, verticalPreset,
          camInputIndex: mediaInput.camInputIndex,
        }),
        '-map', '[v]', ...mediaInput.audioMapArgs,
      ];
    }
    if (rate && dialogue) filterArgs = [...filterArgs, '-af', atempoChain(rate).join(',')];

    return Object.freeze({
      ffmpeg,
      srcPath,
      crop: first,
      encodeArgs,
      cam,
      dialogue,
      dialogueStamp,
      subtitles,
      rate,
      music,
      inputArgs,
      filterArgs,
      pip,
      hasFreeze,
      withSilence,
      camDur,
      verticalPreset,
      srcStamp,
      subtitlesStamp: subtitles ? fileStamp(subtitles) : null,
      camStamp,
      cacheDir,
      expectedSec,
    });
  }

  async function renderClipPart(plan, clip, destPath) {
    const cacheFile = path.join(plan.cacheDir, `${clipCacheKey(plan, clip)}.mp4`);
    if (fs.existsSync(cacheFile)) {
      fs.copyFileSync(cacheFile, destPath);
      return;
    }
    await runFfmpeg(plan.ffmpeg, [...clipArgs(plan, clip), destPath]);
    fs.mkdirSync(plan.cacheDir, { recursive: true });
    const tmp = path.join(plan.cacheDir, `.tmp-${process.pid}-${Date.now()}`);
    fs.copyFileSync(destPath, tmp);
    fs.renameSync(tmp, cacheFile);
  }

  async function mixMusicBed(plan, videoPath, variantOutPath) {
    await runFfmpeg(plan.ffmpeg, [
      '-hide_banner', '-y',
      '-i', videoPath,
      '-stream_loop', '-1', '-i', plan.music.path,
      '-filter_complex', musicMixGraph({ gainDb: plan.music.gainDb, baseHasAudio: probeHasAudio(videoPath) }),
      '-map', '0:v:0', '-c:v', 'copy',
      '-map', '[a]', '-c:a', 'aac',
      '-shortest',
      '-movflags', '+faststart',
      variantOutPath,
    ]);
  }

  async function renderVariant(subtitles, variantOutPath) {
    const plan = buildPlan(subtitles);
    const renderTarget = plan.music ? path.join(workDir, 'pre-music.mp4') : variantOutPath;

    if (clips.length === 1) {
      await renderClipPart(plan, clips[0], renderTarget);
      if (plan.music) await mixMusicBed(plan, renderTarget, variantOutPath);
      verifyOutputDuration(variantOutPath, plan.expectedSec);
      return;
    }

    const parts = [];
    for (let i = 0; i < clips.length; i += 1) {
      const part = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`);
      await renderClipPart(plan, clips[i], part);
      parts.push(part);
    }

    const listFile = path.join(workDir, 'concat.txt');
    fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    await runFfmpeg(plan.ffmpeg, [
      '-hide_banner', '-y',
      '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      renderTarget,
    ]);
    if (plan.music) await mixMusicBed(plan, renderTarget, variantOutPath);
    verifyOutputDuration(variantOutPath, plan.expectedSec);
  }

  const subtitles = opts.subtitles || null;
  await renderVariant(subtitles, outPath);

  if (subtitles && opts.preBurnOutPath) {
    await renderVariant(null, opts.preBurnOutPath);
  }
}

module.exports = {
  findFfmpeg,
  findFfprobe,
  runFfmpeg,
  probeDuration,
  probeDimensions,
  probeHasAudio,
  cropFilter,
  verticalCropScaleFilter,
  camTransformFilters,
  pipOverlayPosition,
  pipFilterGraph,
  hasSubtitlesFilter,
  subtitlesFilter,
  resolveCaptionsPath,
  freezeStillChain,
  speedVideoFilter,
  atempoChain,
  buildMediaInputPlan,
  musicMixGraph,
  verifyOutputDuration,
  clipArgs,
  freezeArgs,
  clipCacheKey,
  applyClips,
};
