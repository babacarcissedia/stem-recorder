'use strict';

/**
 * Pure planner for the export-asset-bundle feature (his part 7): hand the
 * user the plain video, the caption files, and the transcript so they can
 * finish the edit in their own software. Dual CJS + browser, no fs/electron.
 *
 * Stem burns captions into edit/final.mp4 in place on Apply and deletes its
 * render scratch afterwards (see main.js studio:apply / lib/ffmpeg-util
 * applyClips) — there is no separate pre-burn copy retained. So "plain video"
 * here means whatever the take's edited output actually is today: final.mp4
 * when Apply has run (captioned or not, the planner can't tell from a file
 * name alone), or the raw recorded source when it hasn't. That honesty is
 * the point — see the design doc's dependency note for what would close
 * this gap (Lane A retaining a pre-burn intermediate).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StemExportBundle = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  /** transcript.txt / captions.vtt / asr.json are written together by transcribe.js — a partial set means an interrupted run, not "never ran". */
  const ASR_TRIPLET = [
    { name: 'transcript.txt', destName: 'transcript.txt', kind: 'transcript' },
    { name: 'captions.vtt', destName: 'captions.vtt', kind: 'captions-vtt' },
    { name: 'asr.json', destName: 'word-timings.json', kind: 'word-timings' },
  ];

  /** Dest name with a `-2`, `-3`, … suffix inserted before the extension if `used` already has it. */
  function dedupeDestName(destName, used) {
    if (!used.has(destName)) {
      used.add(destName);
      return destName;
    }
    const dot = destName.lastIndexOf('.');
    const stem = dot === -1 ? destName : destName.slice(0, dot);
    const ext = dot === -1 ? '' : destName.slice(dot);
    let n = 2;
    let candidate = `${stem}-${n}${ext}`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${stem}-${n}${ext}`;
    }
    used.add(candidate);
    return candidate;
  }

  /**
   * Plan an export bundle from what is present in a take.
   *
   * @param {object} args
   * @param {string[]} args.takeFiles  file names present at the take root (e.g. 'screen.mp4')
   * @param {string[]} args.editFiles  file names present under the take's edit/ dir (e.g. 'final.mp4')
   * @param {string} args.takeId       the take identifier, validated but not used in naming
   * @returns {{ items: Array<{source: string, destName: string, kind: string}>, missing: string[] }}
   */
  function planExportBundle({ takeFiles, editFiles, takeId } = {}) {
    if (!takeId || typeof takeId !== 'string') throw new Error('planExportBundle: takeId is required');
    const take = new Set(Array.isArray(takeFiles) ? takeFiles : []);
    const edit = new Set(Array.isArray(editFiles) ? editFiles : []);

    const items = [];
    const missing = [];
    const used = new Set();

    // —— video: prefer the composed final.mp4; fall back to the raw source
    // when Apply hasn't run yet (that's a normal state, not a defect, so it
    // is never reported as missing). Only a take with NO video stem at all
    // is genuinely broken for a screen recorder — that we do flag. ——
    if (edit.has('final.mp4')) {
      items.push({
        source: 'edit/final.mp4',
        destName: dedupeDestName('video.mp4', used),
        kind: 'video-final',
      });
    } else if (take.has('screen.mp4')) {
      items.push({
        source: 'screen.mp4',
        destName: dedupeDestName('video-unedited.mp4', used),
        kind: 'video-raw',
      });
    } else if (take.has('cam.mp4')) {
      items.push({
        source: 'cam.mp4',
        destName: dedupeDestName('video-unedited.mp4', used),
        kind: 'video-raw',
      });
    } else {
      missing.push('video');
    }

    // —— bonus: the isolated mic track, when recorded. Not core to the
    // bundle's mission (video + captions + transcript), so never "missing". ——
    if (take.has('audio.mp3')) {
      items.push({
        source: 'audio.mp3',
        destName: dedupeDestName('audio.mp3', used),
        kind: 'audio',
      });
    }

    // —— transcript / captions.vtt / asr.json: written atomically by
    // transcribe.js. None present → transcribe never ran, not applicable.
    // Some present → an interrupted or hand-edited run, worth flagging. ——
    const asrPresentCount = ASR_TRIPLET.filter((f) => edit.has(f.name)).length;
    if (asrPresentCount > 0) {
      for (const f of ASR_TRIPLET) {
        if (edit.has(f.name)) {
          items.push({
            source: `edit/${f.name}`,
            destName: dedupeDestName(f.destName, used),
            kind: f.kind,
          });
        } else {
          missing.push(f.name);
        }
      }
    }

    // —— karaoke .ass caption file(s): purely opportunistic. Nothing in the
    // app writes one to disk today (buildKaraokeAss in lib/captions.js is
    // wired nowhere yet), and there is no manifest flag recording "karaoke
    // was requested" — so an absent .ass is never "missing", only ever
    // "not applicable". Matched by extension, not a fixed file name, so any
    // future writer (captions.ass, karaoke.ass, per-language variants) is
    // picked up without a planner change. Multiple .ass files disambiguate
    // by suffix instead of clobbering each other in the destination. ——
    const assFiles = [...edit].filter((name) => /\.ass$/i.test(name)).sort();
    for (const name of assFiles) {
      items.push({
        source: `edit/${name}`,
        destName: dedupeDestName('captions-karaoke.ass', used),
        kind: 'captions-ass',
      });
    }

    return { items, missing };
  }

  return {
    planExportBundle,
  };
}));
