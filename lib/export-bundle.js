'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StemExportBundle = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TRANSCRIBE_OUTPUT_FILES = [
    { name: 'transcript.txt', destName: 'transcript.txt', kind: 'transcript' },
    { name: 'captions.vtt', destName: 'captions.vtt', kind: 'captions-vtt' },
    { name: 'asr.json', destName: 'word-timings.json', kind: 'word-timings' },
  ];

  function dedupeDestName(destName, usedDestNames) {
    if (!usedDestNames.has(destName)) {
      usedDestNames.add(destName);
      return destName;
    }
    const dot = destName.lastIndexOf('.');
    const stem = dot === -1 ? destName : destName.slice(0, dot);
    const ext = dot === -1 ? '' : destName.slice(dot);
    let suffix = 2;
    let candidate = `${stem}-${suffix}${ext}`;
    while (usedDestNames.has(candidate)) {
      suffix += 1;
      candidate = `${stem}-${suffix}${ext}`;
    }
    usedDestNames.add(candidate);
    return candidate;
  }

  function planVideoItem(takeFileSet, editFileSet, usedDestNames) {
    if (editFileSet.has('final.mp4')) {
      return {
        item: { source: 'edit/final.mp4', destName: dedupeDestName('video.mp4', usedDestNames), kind: 'video-final' },
        missingKind: null,
      };
    }
    if (takeFileSet.has('screen.mp4')) {
      return {
        item: { source: 'screen.mp4', destName: dedupeDestName('video-unedited.mp4', usedDestNames), kind: 'video-raw' },
        missingKind: null,
      };
    }
    if (takeFileSet.has('cam.mp4')) {
      return {
        item: { source: 'cam.mp4', destName: dedupeDestName('video-unedited.mp4', usedDestNames), kind: 'video-raw' },
        missingKind: null,
      };
    }
    return { item: null, missingKind: 'video' };
  }

  function planAudioItem(takeFileSet, usedDestNames) {
    if (!takeFileSet.has('audio.mp3')) return null;
    return { source: 'audio.mp3', destName: dedupeDestName('audio.mp3', usedDestNames), kind: 'audio' };
  }

  function planTranscribeOutputItems(editFileSet, usedDestNames) {
    const anyTranscribeOutputPresent = TRANSCRIBE_OUTPUT_FILES.some((f) => editFileSet.has(f.name));
    if (!anyTranscribeOutputPresent) return { items: [], missingNames: [] };
    const items = [];
    const missingNames = [];
    for (const f of TRANSCRIBE_OUTPUT_FILES) {
      if (editFileSet.has(f.name)) {
        items.push({ source: `edit/${f.name}`, destName: dedupeDestName(f.destName, usedDestNames), kind: f.kind });
      } else {
        missingNames.push(f.name);
      }
    }
    return { items, missingNames };
  }

  function planKaraokeAssItems(editFileSet, usedDestNames) {
    return [...editFileSet]
      .filter((name) => /\.ass$/i.test(name))
      .sort()
      .map((name) => ({
        source: `edit/${name}`,
        destName: dedupeDestName('captions-karaoke.ass', usedDestNames),
        kind: 'captions-ass',
      }));
  }

  function planExportBundle({ takeFiles, editFiles, takeId } = {}) {
    if (!takeId || typeof takeId !== 'string') throw new Error('planExportBundle: takeId is required');
    const takeFileSet = new Set(Array.isArray(takeFiles) ? takeFiles : []);
    const editFileSet = new Set(Array.isArray(editFiles) ? editFiles : []);
    const usedDestNames = new Set();

    const items = [];
    const missing = [];

    const video = planVideoItem(takeFileSet, editFileSet, usedDestNames);
    if (video.item) items.push(video.item);
    if (video.missingKind) missing.push(video.missingKind);

    const audio = planAudioItem(takeFileSet, usedDestNames);
    if (audio) items.push(audio);

    const transcribeOutputs = planTranscribeOutputItems(editFileSet, usedDestNames);
    items.push(...transcribeOutputs.items);
    missing.push(...transcribeOutputs.missingNames);

    items.push(...planKaraokeAssItems(editFileSet, usedDestNames));

    return { items, missing };
  }

  return {
    planExportBundle,
  };
}));
