'use strict';

/** Pure clip-list ops for Edit-T1 (select / split / cut). Dual CJS + browser. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StemClipOps = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function roundMs(t) {
    return Math.round(Number(t) * 1000) / 1000;
  }

  function newClipId() {
    return `clip-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  }

  function clipEnd(clip, fallbackDuration) {
    if (clip.out != null) return Number(clip.out);
    return fallbackDuration != null ? Number(fallbackDuration) : null;
  }

  function findClipAtTime(clips, t, fallbackDuration) {
    const time = Number(t);
    for (let i = 0; i < clips.length; i += 1) {
      const c = clips[i];
      const start = Number(c.in) || 0;
      const end = clipEnd(c, fallbackDuration);
      if (end == null) {
        if (time >= start) return i;
        continue;
      }
      if (time >= start && time < end) return i;
      if (i === clips.length - 1 && time === end) return i;
    }
    return -1;
  }

  function splitAt(clips, index, at, fallbackDuration) {
    if (index < 0 || index >= clips.length) throw new Error('no clip selected');
    const c = clips[index];
    const start = Number(c.in) || 0;
    const end = clipEnd(c, fallbackDuration);
    const t = roundMs(at);
    if (end == null) throw new Error('clip has no end — set Out first');
    if (t <= start + 0.05 || t >= end - 0.05) {
      throw new Error('split point must be inside the selected clip');
    }
    const left = { ...c, id: c.id || newClipId(), in: start, out: t };
    const right = { ...c, id: newClipId(), in: t, out: end };
    return [...clips.slice(0, index), left, right, ...clips.slice(index + 1)];
  }

  function cutClip(clips, index) {
    if (index < 0 || index >= clips.length) throw new Error('no clip selected');
    if (clips.length <= 1) throw new Error('keep at least one clip');
    return clips.filter((_, i) => i !== index);
  }

  function cutRange(clips, rangeIn, rangeOut, fallbackDuration) {
    const a = roundMs(rangeIn);
    const b = roundMs(rangeOut);
    if (!(b > a + 0.05)) throw new Error('cut range Out must be after In');

    const next = [];
    for (const c of clips) {
      const start = Number(c.in) || 0;
      const end = clipEnd(c, fallbackDuration);
      if (end == null) {
        next.push({ ...c });
        continue;
      }
      if (end <= a || start >= b) {
        next.push({ ...c, in: start, out: end });
        continue;
      }
      if (start < a) {
        next.push({ ...c, id: newClipId(), in: start, out: a });
      }
      if (end > b) {
        next.push({ ...c, id: newClipId(), in: b, out: end });
      }
    }
    if (!next.length) throw new Error('cut would remove all media');
    return next;
  }

  /** Duration of one clip on the output timeline. */
  function clipDuration(clip, fallbackDuration) {
    const start = Number(clip.in) || 0;
    const end = clipEnd(clip, fallbackDuration);
    if (end == null) return 0;
    return Math.max(0, end - start);
  }

  /** Total output duration of the sequence. */
  function totalOutputDuration(clips, fallbackDuration) {
    return clips.reduce((sum, c) => sum + clipDuration(c, fallbackDuration), 0);
  }

  /**
   * Map output playhead → { index, sourceTime, offsetInClip }.
   */
  function outputToSource(clips, outputT, fallbackDuration) {
    let t = Math.max(0, Number(outputT) || 0);
    let acc = 0;
    for (let i = 0; i < clips.length; i += 1) {
      const dur = clipDuration(clips[i], fallbackDuration);
      if (dur <= 0) continue;
      if (t < acc + dur || i === clips.length - 1) {
        const offset = Math.min(Math.max(0, t - acc), Math.max(0, dur - 0.001));
        return {
          index: i,
          sourceTime: roundMs((Number(clips[i].in) || 0) + offset),
          offsetInClip: offset,
          clipStartOut: acc,
          clipDur: dur,
        };
      }
      acc += dur;
    }
    return { index: 0, sourceTime: Number(clips[0]?.in) || 0, offsetInClip: 0, clipStartOut: 0, clipDur: 0 };
  }

  /** Map source time inside clips[index] → output time. */
  function sourceToOutput(clips, index, sourceTime, fallbackDuration) {
    let acc = 0;
    for (let i = 0; i < index; i += 1) acc += clipDuration(clips[i], fallbackDuration);
    const start = Number(clips[index].in) || 0;
    return roundMs(acc + Math.max(0, Number(sourceTime) - start));
  }

  /**
   * Clamp a crop rect to the source frame. Coordinates are normalized 0–1 of
   * the source frame ({ x, y, w, h }). Returns null for invalid rects and for
   * (near-)full-frame rects — "no crop" is stored as an absent key.
   */
  function normalizeCrop(crop, minSize) {
    if (!crop || typeof crop !== 'object') return null;
    const min = minSize == null ? 0.05 : minSize;
    let { x, y, w, h } = crop;
    x = Number(x); y = Number(y); w = Number(w); h = Number(h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    x = Math.min(Math.max(x, 0), 1 - min);
    y = Math.min(Math.max(y, 0), 1 - min);
    w = Math.min(Math.max(w, min), 1 - x);
    h = Math.min(Math.max(h, min), 1 - y);
    const r = (v) => Math.round(v * 10000) / 10000;
    x = r(x); y = r(y); w = r(w); h = r(h);
    if (x === 0 && y === 0 && w === 1 && h === 1) return null;
    return { x, y, w, h };
  }

  /**
   * Take-level cam settings ({ mirror, rotate, pip }). Cam-only: screen stays
   * untouched. "No settings" is stored as an absent key, like crop.
   * rotate is clockwise degrees in 90° steps (phone orientation).
   * pip (cam picture-in-picture on Apply) defaults ON when the take has a
   * cam stem, so only the opt-out (pip: false) is stored.
   */
  function normalizeCam(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    if (cam.mirror === true) out.mirror = true;
    if (cam.rotate === 90 || cam.rotate === 180 || cam.rotate === 270) out.rotate = cam.rotate;
    if (cam.pip === false) out.pip = false;
    return Object.keys(out).length ? out : null;
  }

  function cropsEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
  }

  /** Set (or clear, when crop is null) the same crop rect on every clip. */
  function setCrop(clips, crop) {
    const next = normalizeCrop(crop);
    return clips.map((c) => {
      const copy = { ...c };
      if (next) copy.crop = { ...next };
      else delete copy.crop;
      return copy;
    });
  }

  function cloneClip(clip) {
    const copy = { ...clip };
    if (clip.crop) copy.crop = { ...clip.crop };
    return copy;
  }

  /**
   * Deep-copy a slice of clips for the clipboard. The clones keep every
   * per-clip flag (source, in/out, crop) so a later paste reproduces them.
   */
  function copySlice(clips, startIndex, count) {
    const n = count == null ? 1 : Math.floor(Number(count));
    if (startIndex < 0 || startIndex >= clips.length) throw new Error('no clip selected');
    if (!(n >= 1) || startIndex + n > clips.length) throw new Error('copy range out of bounds');
    return clips.slice(startIndex, startIndex + n).map(cloneClip);
  }

  /**
   * Insert clipboard clips after clips[afterIndex] (or at the start when
   * afterIndex is -1). Pasted clips get fresh ids; ripple is implicit —
   * output time is the sum of clip durations, so everything after shifts.
   */
  function pasteAfter(clips, clipboard, afterIndex) {
    if (!Array.isArray(clipboard) || !clipboard.length) throw new Error('clipboard is empty');
    const at = Math.max(-1, Math.min(Number(afterIndex), clips.length - 1));
    const pasted = clipboard.map((c) => ({ ...cloneClip(c), id: newClipId() }));
    return {
      clips: [...clips.slice(0, at + 1), ...pasted, ...clips.slice(at + 1)],
      firstPastedIndex: at + 1,
      pastedCount: pasted.length,
    };
  }

  /** Edge-trim one clip; min length defaults to 0.1s. */
  function trimClip(clips, index, nextIn, nextOut, fallbackDuration, minLen) {
    const min = minLen == null ? 0.1 : minLen;
    if (index < 0 || index >= clips.length) throw new Error('no clip selected');
    const c = clips[index];
    const start = nextIn != null ? roundMs(nextIn) : (Number(c.in) || 0);
    let end = nextOut != null ? roundMs(nextOut) : clipEnd(c, fallbackDuration);
    if (end == null) throw new Error('clip has no end');
    if (end - start < min) throw new Error('clip too short');
    return clips.map((x, i) => (i === index ? { ...c, in: start, out: end } : { ...x }));
  }

  return {
    roundMs,
    newClipId,
    clipEnd,
    findClipAtTime,
    splitAt,
    cutClip,
    cutRange,
    copySlice,
    pasteAfter,
    trimClip,
    normalizeCrop,
    normalizeCam,
    cropsEqual,
    setCrop,
    clipDuration,
    totalOutputDuration,
    outputToSource,
    sourceToOutput,
  };
}));
