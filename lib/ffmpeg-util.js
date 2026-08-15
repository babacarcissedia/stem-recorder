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

/**
 * Accurate trim/concat. clips = [{ in, out|null, crop? }, ...]
 * crop is one rect per take for now: mismatched per-clip crops would produce
 * mixed-dimension parts the stream-copy concat cannot join (per-clip crop =
 * Edit-T2), so they are rejected up front.
 */
async function applyClips(srcPath, clips, outPath, workDir) {
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

  const filterArgs = first ? ['-vf', cropFilter(first)] : [];

  if (clips.length === 1) {
    const { in: start, out: end } = clips[0];
    const args = ['-hide_banner', '-y', '-i', srcPath, '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    args.push(...filterArgs, ...encodeArgs, outPath);
    await runFfmpeg(ffmpeg, args);
    return;
  }

  const parts = [];
  for (let i = 0; i < clips.length; i += 1) {
    const { in: start, out: end } = clips[i];
    const part = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`);
    const args = ['-hide_banner', '-y', '-i', srcPath, '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    args.push(...filterArgs, ...encodeArgs, part);
    await runFfmpeg(ffmpeg, args);
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
  cropFilter,
  applyClips,
};
