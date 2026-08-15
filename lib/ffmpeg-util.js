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

/**
 * Accurate trim/concat. clips = [{ in, out|null }, ...]
 */
async function applyClips(srcPath, clips, outPath, workDir) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg not found on PATH');
  const fs = require('fs');
  const path = require('path');
  fs.mkdirSync(workDir, { recursive: true });

  const encodeArgs = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
  ];

  if (clips.length === 1) {
    const { in: start, out: end } = clips[0];
    const args = ['-hide_banner', '-y', '-i', srcPath, '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    args.push(...encodeArgs, outPath);
    await runFfmpeg(ffmpeg, args);
    return;
  }

  const parts = [];
  for (let i = 0; i < clips.length; i += 1) {
    const { in: start, out: end } = clips[i];
    const part = path.join(workDir, `part-${String(i).padStart(3, '0')}.mp4`);
    const args = ['-hide_banner', '-y', '-i', srcPath, '-ss', String(start)];
    if (end != null) args.push('-to', String(end));
    args.push(...encodeArgs, part);
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
  applyClips,
};
