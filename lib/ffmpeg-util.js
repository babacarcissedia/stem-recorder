'use strict';

const { spawn, spawnSync } = require('child_process');

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
 */
function pipFilterGraph({ crop, cam, pipWidth, margin, layout, freezeDur }) {
  const base = crop ? `[0:v]${cropFilter(crop)}[base]` : '[0:v]null[base]';
  const camSteps = [
    ...camTransformFilters(cam),
    `scale=w=${pipWidth}:h=-2`,
  ];
  const lines = [
    base,
    `[1:v]${camSteps.join(',')}[pip]`,
    `[base][pip]overlay=${pipOverlayPosition(layout, margin)}${freezeDur ? '[ov]' : '[v]'}`,
  ];
  if (freezeDur) lines.push(`[ov]${freezeStillChain(freezeDur)}[v]`);
  return lines.join(';');
}

/** Seek slightly before a freeze frame so a frame at the exact clip end still decodes. */
const FREEZE_SEEK_BACKOFF = 0.05;

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
 */
async function applyClips(srcPath, clips, outPath, workDir, opts = {}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found on PATH');
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(workDir, { recursive: true });

  const crops = clips.map((c) => c.crop || null);
  const first = crops.find(Boolean) || null;
  if (first && crops.some((c) => !c || c.x !== first.x || c.y !== first.y || c.w !== first.w || c.h !== first.h)) {
    throw new Error('clips have different crop rects — one crop per take for now');
  }

  const encodeArgs = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
  ];

  const cam = opts.cam || null;
  let inputArgs = ['-i', srcPath];
  let filterArgs = first ? ['-vf', cropFilter(first)] : [];
  let pip = null;
  if (cam) {
    const dim = probeDimensions(srcPath);
    if (!dim) throw new Error('cannot probe screen dimensions for cam PiP');
    const baseWidth = first ? Math.floor((dim.width * first.w) / 2) * 2 : dim.width;
    const layout = cam.layout || null;
    const widthFrac = layout ? layout.w : PIP_WIDTH_FRAC;
    pip = {
      layout,
      pipWidth: Math.max(2, Math.floor((baseWidth * widthFrac) / 2) * 2),
      margin: Math.max(PIP_MIN_MARGIN, Math.round(baseWidth * PIP_MARGIN_FRAC)),
    };
    inputArgs = ['-i', srcPath, '-i', cam.path];
    filterArgs = [
      '-filter_complex', pipFilterGraph({ crop: first, cam, ...pip }),
      '-map', '[v]', '-map', '0:a?',
    ];
  }

  const hasFreeze = clips.some((c) => c.freeze);
  const withSilence = hasFreeze && probeHasAudio(srcPath);
  // The cam may end before the freeze frame; clamp its seek so the overlay
  // still gets a frame (its own last one) instead of an empty stream.
  const camDur = hasFreeze && cam ? probeDuration(cam.path) : null;

  function freezeArgs(clip, outFile) {
    const start = Number(clip.in) || 0;
    const dur = Number(clip.out) - start;
    if (!(dur > 0)) throw new Error('freeze segment needs a positive duration');
    const seekTo = Math.max(0, start - FREEZE_SEEK_BACKOFF);
    const args = ['-hide_banner', '-y', '-ss', String(seekTo), '-i', srcPath];
    if (cam) {
      const camSeek = camDur != null ? Math.min(seekTo, Math.max(0, camDur - 0.2)) : seekTo;
      args.push('-ss', String(camSeek), '-i', cam.path);
    }
    if (withSilence) {
      args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
    }
    if (cam) {
      args.push('-filter_complex', pipFilterGraph({ crop: first, cam, ...pip, freezeDur: dur }), '-map', '[v]');
      if (withSilence) args.push('-map', '2:a');
    } else {
      args.push('-vf', [first ? cropFilter(first) : null, freezeStillChain(dur)].filter(Boolean).join(','), '-map', '0:v:0');
      if (withSilence) args.push('-map', '1:a:0');
    }
    if (!withSilence) args.push('-an');
    args.push('-t', String(dur), ...encodeArgs, outFile);
    return args;
  }

  function clipArgs(clip, outFile) {
    if (clip.freeze) return freezeArgs(clip, outFile);
    const args = ['-hide_banner', '-y', ...inputArgs, '-ss', String(clip.in)];
    if (clip.out != null) args.push('-to', String(clip.out));
    args.push(...filterArgs, ...encodeArgs, outFile);
    return args;
  }

  if (clips.length === 1) {
    await runFfmpeg(ffmpeg, clipArgs(clips[0], outPath));
    return;
  }

  const parts = [];
  for (let i = 0; i < clips.length; i += 1) {
    const part = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`);
    await runFfmpeg(ffmpeg, clipArgs(clips[i], part));
    parts.push(part);
  }

  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await runFfmpeg(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'concat', '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    outPath,
  ]);
}

module.exports = {
  findFfmpeg,
  findFfprobe,
  runFfmpeg,
  probeDuration,
  probeDimensions,
  probeHasAudio,
  cropFilter,
  camTransformFilters,
  pipOverlayPosition,
  pipFilterGraph,
  freezeStillChain,
  applyClips,
};
