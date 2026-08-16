'use strict';

/**
 * Pure geometry for export presets. Stem has no aspect handling today —
 * output keeps the source screen's ratio — so this is what makes a long
 * landscape take reusable as a vertical 9:16 short. Returns plain data
 * (numbers/objects) for an ffmpeg filter builder to consume later; it does
 * not build filter strings itself (that duplicates lib/ffmpeg-util.js's
 * job) and stays free of electron/fs/child_process per ARCHITECTURE.md's
 * pure edit-model group.
 */

const DEFAULT_TARGET = { width: 1080, height: 1920 };
// Typical webcam portrait crop when the actual cam resolution isn't known yet.
const DEFAULT_CAM_ASPECT = 3 / 4;
const DEFAULT_PIP_WIDTH_FRACTION = 0.35;
const DEFAULT_PIP_MARGIN_FRACTION = 0.04;
const DEFAULT_PIP_POSITION = 'bottom-right';
const PIP_POSITIONS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left', 'bottom-center']);

/** Round to the nearest even integer, never above the input (H.264 requires even dims). */
function ensureEven(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  return n % 2 === 0 ? n : n - 1;
}

/**
 * Largest centered rect of sourceWidth x sourceHeight matching the target
 * aspect ratio (targetWidth / targetHeight). Crops the long axis; the
 * short axis is kept full. Even dims, centered.
 *
 * @returns {{x: number, y: number, w: number, h: number}} source-pixel space
 */
function computeCropRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sw = Number(sourceWidth);
  const sh = Number(sourceHeight);
  const tw = Number(targetWidth);
  const th = Number(targetHeight);
  if (!(sw > 0) || !(sh > 0) || !(tw > 0) || !(th > 0)) {
    throw new Error('computeCropRect: all dimensions must be positive numbers');
  }

  const targetAspect = tw / th;
  const sourceAspect = sw / sh;
  let cropWidth;
  let cropHeight;
  if (sourceAspect > targetAspect) {
    // source is relatively wider than the target — crop the sides, keep full height
    cropHeight = sh;
    cropWidth = sh * targetAspect;
  } else {
    // source is relatively taller (or equal) — crop top/bottom, keep full width
    cropWidth = sw;
    cropHeight = sw / targetAspect;
  }

  cropWidth = ensureEven(Math.min(cropWidth, sw));
  cropHeight = ensureEven(Math.min(cropHeight, sh));
  const x = ensureEven((sw - cropWidth) / 2);
  const y = ensureEven((sh - cropHeight) / 2);
  return {
    x, y, w: cropWidth, h: cropHeight,
  };
}

function normalizePipPosition(position) {
  return PIP_POSITIONS.has(position) ? position : DEFAULT_PIP_POSITION;
}

/**
 * Cam PiP rectangle in OUTPUT (target) pixel space. Width is a fraction of
 * the output width; height follows the cam aspect ratio so the box never
 * distorts the cam feed. Even dims, clamped fully inside the frame.
 *
 * @param {{cam?: {width: number, height: number}, position?: string, widthFraction?: number, marginFraction?: number}} [options]
 * @returns {{x: number, y: number, w: number, h: number, position: string}}
 */
function computePipRect(targetWidth, targetHeight, options = {}) {
  const tw = Number(targetWidth);
  const th = Number(targetHeight);
  if (!(tw > 0) || !(th > 0)) throw new Error('computePipRect: target dimensions must be positive numbers');

  const camAspect = options.cam && Number(options.cam.width) > 0 && Number(options.cam.height) > 0
    ? Number(options.cam.width) / Number(options.cam.height)
    : DEFAULT_CAM_ASPECT;
  const widthFraction = Number.isFinite(options.widthFraction) ? options.widthFraction : DEFAULT_PIP_WIDTH_FRACTION;
  const marginFraction = Number.isFinite(options.marginFraction)
    ? options.marginFraction
    : DEFAULT_PIP_MARGIN_FRACTION;
  const position = normalizePipPosition(options.position);

  const w = ensureEven(tw * widthFraction);
  const h = ensureEven(w / camAspect);
  const margin = ensureEven(tw * marginFraction);

  let x;
  let y;
  switch (position) {
    case 'bottom-left':
      x = margin;
      y = th - h - margin;
      break;
    case 'top-right':
      x = tw - w - margin;
      y = margin;
      break;
    case 'top-left':
      x = margin;
      y = margin;
      break;
    case 'bottom-center':
      x = (tw - w) / 2;
      y = th - h - margin;
      break;
    case 'bottom-right':
    default:
      x = tw - w - margin;
      y = th - h - margin;
      break;
  }

  x = ensureEven(Math.min(Math.max(x, 0), Math.max(tw - w, 0)));
  y = ensureEven(Math.min(Math.max(y, 0), Math.max(th - h, 0)));
  return {
    x, y, w, h, position,
  };
}

/**
 * Full vertical (9:16 by default) export preset: crop the source screen to
 * the target aspect, settle the target to even dims, and place the cam PiP
 * inside the resulting frame.
 *
 * @param {{source: {width: number, height: number}, target?: {width: number, height: number}, cam?: {width: number, height: number}, pip?: object}} spec
 * @returns {{crop: object, scale: {width: number, height: number}, pip: object}}
 */
function buildVerticalPreset({
  source, target = DEFAULT_TARGET, cam = null, pip = {},
} = {}) {
  if (!source || !(Number(source.width) > 0) || !(Number(source.height) > 0)) {
    throw new Error('buildVerticalPreset: source {width, height} is required');
  }
  const scale = { width: ensureEven(target.width), height: ensureEven(target.height) };
  const crop = computeCropRect(source.width, source.height, scale.width, scale.height);
  const pipRect = computePipRect(scale.width, scale.height, { ...pip, cam });
  return { crop, scale, pip: pipRect };
}

module.exports = {
  DEFAULT_TARGET,
  DEFAULT_CAM_ASPECT,
  DEFAULT_PIP_WIDTH_FRACTION,
  DEFAULT_PIP_MARGIN_FRACTION,
  ensureEven,
  computeCropRect,
  computePipRect,
  buildVerticalPreset,
};
