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

  return {
    roundMs,
    newClipId,
    clipEnd,
    findClipAtTime,
    splitAt,
    cutClip,
    cutRange,
  };
}));
