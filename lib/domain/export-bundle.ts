'use strict';

export type ExportItem = { source: string; destName: string; kind: string };

const api = (() => {
  const TRANSCRIBE_OUTPUT_FILES = [
    { name: 'transcript.txt', destName: 'transcript.txt', kind: 'transcript' },
    { name: 'captions.vtt', destName: 'captions.vtt', kind: 'captions-vtt' },
    { name: 'asr.json', destName: 'word-timings.json', kind: 'word-timings' },
  ];

  function dedupeDestName(destName: string, usedDestNames: Set<string>): string {
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

  function planVideoItems(
    takeFileSet: Set<string>,
    editFileSet: Set<string>,
    usedDestNames: Set<string>,
  ): { items: ExportItem[]; missingKind: string | null } {
    if (editFileSet.has('final.mp4') && editFileSet.has('final-no-captions.mp4')) {
      return {
        items: [
          {
            source: 'edit/final.mp4',
            destName: dedupeDestName('video-captions-burned.mp4', usedDestNames),
            kind: 'video-final-captions-burned',
          },
          {
            source: 'edit/final-no-captions.mp4',
            destName: dedupeDestName('video-no-captions.mp4', usedDestNames),
            kind: 'video-final-no-captions',
          },
        ],
        missingKind: null,
      };
    }
    if (editFileSet.has('final.mp4')) {
      return {
        items: [{ source: 'edit/final.mp4', destName: dedupeDestName('video.mp4', usedDestNames), kind: 'video-final' }],
        missingKind: null,
      };
    }
    if (takeFileSet.has('screen.mp4')) {
      return {
        items: [{ source: 'screen.mp4', destName: dedupeDestName('video-unedited.mp4', usedDestNames), kind: 'video-raw' }],
        missingKind: null,
      };
    }
    if (takeFileSet.has('cam.mp4')) {
      return {
        items: [{ source: 'cam.mp4', destName: dedupeDestName('video-unedited.mp4', usedDestNames), kind: 'video-raw' }],
        missingKind: null,
      };
    }
    return { items: [], missingKind: 'video' };
  }

  function planAudioItem(takeFileSet: Set<string>, usedDestNames: Set<string>): ExportItem | null {
    if (!takeFileSet.has('audio.mp3')) return null;
    return { source: 'audio.mp3', destName: dedupeDestName('audio.mp3', usedDestNames), kind: 'audio' };
  }

  function planTranscribeOutputItems(
    editFileSet: Set<string>,
    usedDestNames: Set<string>,
  ): { items: ExportItem[]; missingNames: string[] } {
    const anyTranscribeOutputPresent = TRANSCRIBE_OUTPUT_FILES.some((f) => editFileSet.has(f.name));
    if (!anyTranscribeOutputPresent) return { items: [], missingNames: [] };
    const items: ExportItem[] = [];
    const missingNames: string[] = [];
    for (const f of TRANSCRIBE_OUTPUT_FILES) {
      if (editFileSet.has(f.name)) {
        items.push({ source: `edit/${f.name}`, destName: dedupeDestName(f.destName, usedDestNames), kind: f.kind });
      } else {
        missingNames.push(f.name);
      }
    }
    return { items, missingNames };
  }

  function planKaraokeAssItems(editFileSet: Set<string>, usedDestNames: Set<string>): ExportItem[] {
    return [...editFileSet]
      .filter((name) => /\.ass$/i.test(name))
      .sort()
      .map((name) => ({
        source: `edit/${name}`,
        destName: dedupeDestName('captions-karaoke.ass', usedDestNames),
        kind: 'captions-ass',
      }));
  }

  function planExportBundle(
    { takeFiles, editFiles, takeId }: { takeFiles?: string[]; editFiles?: string[]; takeId?: string } = {},
  ): { items: ExportItem[]; missing: string[] } {
    if (!takeId || typeof takeId !== 'string') throw new Error('planExportBundle: takeId is required');
    const takeFileSet = new Set(Array.isArray(takeFiles) ? takeFiles : []);
    const editFileSet = new Set(Array.isArray(editFiles) ? editFiles : []);
    const usedDestNames = new Set<string>();

    const items: ExportItem[] = [];
    const missing: string[] = [];

    const video = planVideoItems(takeFileSet, editFileSet, usedDestNames);
    items.push(...video.items);
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
})();

export const {
  planExportBundle,
} = api;
