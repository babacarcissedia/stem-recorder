'use strict';

/** Pure clip-list ops for Edit-T1 (select / split / cut). Dual CJS + browser. */
const api = (() => {
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
      // Freeze segments reuse source coordinates for their held frame; they
      // are not source ranges, so source-time lookups skip them.
      if (c.freeze) continue;
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
    if (c.freeze) throw new Error('cannot split a freeze segment — trim its edges instead');
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
          // A freeze segment shows one frame for its whole span.
          sourceTime: roundMs((Number(clips[i].in) || 0) + (clips[i].freeze ? 0 : offset)),
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
   * PiP layout ({ x, y, w }) normalized 0–1 of the output frame (the cropped
   * screen base): x/y = top-left corner, w = width fraction; height follows
   * from the cam aspect. Absent = the Edit-T2a bottom-right default. y is
   * only lower-bounded against the frame here (the PiP height is unknown
   * without the cam aspect) — render-time overlay expressions and the
   * preview clamp the bottom/right edges.
   */
  function normalizePipLayout(layout) {
    if (!layout || typeof layout !== 'object') return null;
    let { x, y, w } = layout;
    x = Number(x); y = Number(y); w = Number(w);
    if (![x, y, w].every(Number.isFinite)) return null;
    w = Math.min(Math.max(w, 0.1), 0.8);
    x = Math.min(Math.max(x, 0), 1 - w);
    y = Math.min(Math.max(y, 0), 0.95);
    const r = (v) => Math.round(v * 10000) / 10000;
    return { x: r(x), y: r(y), w: r(w) };
  }

  /**
   * Take-level cam settings ({ mirror, rotate, pip, pipLayout }). Cam-only:
   * screen stays untouched. "No settings" is stored as an absent key, like
   * crop. rotate is clockwise degrees in 90° steps (phone orientation).
   * pip (cam picture-in-picture on Apply) defaults ON when the take has a
   * cam stem, so only the opt-out (pip: false) is stored.
   */
  function normalizeCam(cam) {
    if (!cam || typeof cam !== 'object') return null;
    const out = {};
    if (cam.mirror === true) out.mirror = true;
    if (cam.rotate === 90 || cam.rotate === 180 || cam.rotate === 270) out.rotate = cam.rotate;
    if (cam.pip === false) out.pip = false;
    const layout = normalizePipLayout(cam.pipLayout);
    if (layout) out.pipLayout = layout;
    return Object.keys(out).length ? out : null;
  }

  /**
   * Constant export speed (Edit-T2e), take-level. Clamped to 0.25–4× (the
   * atempo-chain range applyClips can honor); 1× is "no speed change" and is
   * stored as an absent key, like crop/cam.
   */
  function normalizeExportRate(rate) {
    if (rate == null || rate === '') return null; // Number(null|'') is 0, not NaN
    const r = Number(rate);
    if (!Number.isFinite(r)) return null;
    const clamped = Math.min(Math.max(r, 0.25), 4);
    const rounded = Math.round(clamped * 100) / 100;
    return rounded === 1 ? null : rounded;
  }

  /**
   * Take-level music bed (Edit-T2e): { path, gainDb }. gainDb is the fixed
   * duck level the bed is mixed under the dialogue at (default −18 dB,
   * clamped −60–0 so the bed can never sit above the dialogue). No path →
   * no music, stored as an absent key.
   */
  function normalizeMusic(music) {
    if (!music || typeof music !== 'object') return null;
    const musicPath = typeof music.path === 'string' ? music.path.trim() : '';
    if (!musicPath) return null;
    let gainDb = Number(music.gainDb);
    if (!Number.isFinite(gainDb)) gainDb = -18;
    gainDb = Math.round(Math.min(Math.max(gainDb, -60), 0) * 10) / 10;
    return { path: musicPath, gainDb };
  }

  function normalizeCaptions(captions) {
    if (!captions || typeof captions !== 'object' || captions.burn !== true) return null;
    const out = { burn: true };
    if (captions.style === 'karaoke') out.style = 'karaoke';
    return out;
  }

  function normalizeVertical(vertical) {
    return vertical === true ? true : null;
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

  /**
   * Insert a freeze segment after clips[index]: a still that holds the
   * clip's last frame for durationSec on the output timeline. It is a
   * regular clip ({ in, out, freeze: true }) where `in` is the frozen
   * frame's source time and out - in the hold length, so duration math,
   * trim, undo and copy/paste all apply unchanged.
   */
  function insertFreezeAfter(clips, index, durationSec, fallbackDuration) {
    if (index < 0 || index >= clips.length) throw new Error('no clip selected');
    const c = clips[index];
    if (c.freeze) throw new Error('already a freeze segment — trim its edges to adjust');
    const end = clipEnd(c, fallbackDuration);
    if (end == null) throw new Error('clip has no end — set Out first');
    const dur = roundMs(durationSec == null ? 1.5 : Number(durationSec));
    if (!(dur >= 0.1 && dur <= 60)) throw new Error('freeze duration must be 0.1–60s');
    const freeze = {
      ...cloneClip(c),
      id: newClipId(),
      in: roundMs(end),
      out: roundMs(end + dur),
      freeze: true,
    };
    return {
      clips: [...clips.slice(0, index + 1), freeze, ...clips.slice(index + 1)],
      freezeIndex: index + 1,
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
    insertFreezeAfter,
    trimClip,
    normalizeCrop,
    normalizeCam,
    normalizePipLayout,
    normalizeExportRate,
    normalizeMusic,
    normalizeCaptions,
    normalizeVertical,
    cropsEqual,
    setCrop,
    clipDuration,
    totalOutputDuration,
    outputToSource,
    sourceToOutput,
  };
})();

export const {
  roundMs,
  newClipId,
  clipEnd,
  findClipAtTime,
  splitAt,
  cutClip,
  cutRange,
  copySlice,
  pasteAfter,
  insertFreezeAfter,
  trimClip,
  normalizeCrop,
  normalizeCam,
  normalizePipLayout,
  normalizeExportRate,
  normalizeMusic,
  normalizeCaptions,
  normalizeVertical,
  cropsEqual,
  setCrop,
  clipDuration,
  totalOutputDuration,
  outputToSource,
  sourceToOutput,
} = api;
