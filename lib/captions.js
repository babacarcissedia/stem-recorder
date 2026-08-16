'use strict';

/**
 * Pure caption chunking + ASS karaoke generation from word-level ASR
 * timings. No electron/fs/child_process — this runs in smokes today and
 * could run in a web/worker context later (see ARCHITECTURE.md's pure
 * edit-model group). Input word shape: { word, start, end } (seconds).
 *
 * Today Stem burns Whisper's raw 5-9s segments as one caption block. This
 * module (a) chunks word timings into small N-word cues so captions don't
 * dump a paragraph on screen at once, and (b) renders those cues as an ASS
 * document with libass karaoke (\k) tags so each word highlights as it's
 * read — libass supports this natively, so we get it without a frame-by-
 * frame canvas renderer.
 */

const DEFAULT_WORDS_PER_CUE = 3;
// A pause this long inside a would-be cue reads as two separate thoughts —
// splitting here keeps a cue from lingering on-screen through dead air with
// its last word still highlighted. Below this, the gap folds into timing
// instead (see buildKaraokeCueText).
const DEFAULT_MAX_GAP_SEC = 1.2;

const DEFAULT_ASS_OPTIONS = {
  resolutionX: 1080,
  resolutionY: 1920,
  fontName: 'Arial',
  fontSize: 64,
  // Fraction of frame height, measured from the top, where the cue baseline
  // sits. The source developer iterated from two-thirds (0.667) to three-
  // quarters (0.75) down the frame — keep this a parameter, not a constant.
  verticalPosition: 0.75,
  wordsPerCue: DEFAULT_WORDS_PER_CUE,
  maxGapSec: DEFAULT_MAX_GAP_SEC,
  // ASS colours are &HAABBGGRR. White = already-spoken text; yellow = the
  // karaoke fill colour libass shows for the word/segment mid-highlight.
  primaryColour: '&H00FFFFFF',
  secondaryColour: '&H0000FFFF',
  outlineColour: '&H00000000',
  backColour: '&H00000000',
  outline: 3,
  shadow: 0,
  bold: true,
};

/**
 * Group word timings into N-word caption cues.
 *
 * Handles: gaps between words (see maxGapSec above — a large intra-group
 * gap forces an early split), a trailing partial group (fewer than N words
 * — always emitted), words with zero or inverted duration (end <= start
 * clamps to a zero-length word rather than throwing), and empty input
 * (returns []). Words missing a usable start inherit the previous word's
 * end so the chunk stays temporally ordered instead of crashing on NaN.
 *
 * @param {{word: string, start: number, end: number}[]} words
 * @param {{wordsPerCue?: number, maxGapSec?: number}} [options]
 * @returns {{words: object[], start: number, end: number}[]}
 */
function chunkWords(words, options = {}) {
  if (!Array.isArray(words) || !words.length) return [];

  const wordsPerCue = Number.isInteger(options.wordsPerCue) && options.wordsPerCue > 0
    ? options.wordsPerCue
    : DEFAULT_WORDS_PER_CUE;
  const maxGapSec = Number.isFinite(options.maxGapSec) ? options.maxGapSec : DEFAULT_MAX_GAP_SEC;

  const cues = [];
  let current = [];
  let prevEnd = null;

  for (const raw of words) {
    const word = String(raw && raw.word != null ? raw.word : '').trim();
    if (!word) continue; // skip blank/whitespace tokens rather than emit an empty cue word

    let start = Number(raw.start);
    if (!Number.isFinite(start)) start = prevEnd != null ? prevEnd : 0;
    let end = Number(raw.end);
    if (!Number.isFinite(end) || end < start) end = start; // inverted/zero duration clamps flat

    const gap = prevEnd != null ? start - prevEnd : 0;
    const shouldSplit = current.length > 0 && (current.length >= wordsPerCue || gap >= maxGapSec);
    if (shouldSplit) {
      cues.push(finalizeCue(current));
      current = [];
    }
    current.push({ word, start, end });
    prevEnd = end;
  }
  if (current.length) cues.push(finalizeCue(current));
  return cues;
}

function finalizeCue(cueWords) {
  return {
    words: cueWords.map((w) => ({ ...w })),
    start: cueWords[0].start,
    end: cueWords[cueWords.length - 1].end,
  };
}

/** Seconds → non-negative integer centiseconds (the \k unit — get this wrong and karaoke drifts). */
function centiseconds(seconds) {
  const n = Math.round(Number(seconds) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Escape caption text for a libass ASS Dialogue Text field. Braces open/
 * close override blocks so a literal brace in speech would otherwise be
 * parsed as a tag; backslashes must be doubled for the same reason.
 * Newlines become the ASS line-break tag. Commas need NO escaping here —
 * Text is always the LAST field in the Dialogue line and is greedy, so it
 * absorbs any commas in the spoken text without shifting fields.
 */
function escapeAssText(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

/**
 * Seconds → ASS timestamp H:MM:SS.cc (centiseconds, single-digit hour —
 * NOT SRT's H:MM:SS,mmm). Built entirely in integer centisecond space so
 * there's no float-rounding carry bug at the minute/hour boundary.
 */
function toAssTimestamp(seconds) {
  let cs = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const h = Math.floor(cs / 360000);
  cs -= h * 360000;
  const m = Math.floor(cs / 6000);
  cs -= m * 6000;
  const s = Math.floor(cs / 100);
  cs -= s * 100;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

/**
 * Build the \k-tagged Text for one cue's words. Each word's own \k covers
 * its spoken duration; a gap to the next word becomes a separate, textless
 * \k hold so the sum of every \k in the line equals the cue's total span
 * (last word end − first word start) exactly — no drift against the
 * Dialogue Start/End timestamps.
 */
function buildKaraokeCueText(cueWords) {
  let text = '';
  for (let i = 0; i < cueWords.length; i += 1) {
    const word = cueWords[i];
    text += `{\\k${centiseconds(word.end - word.start)}}${escapeAssText(word.word)}`;
    const isLast = i === cueWords.length - 1;
    if (!isLast) {
      text += ' ';
      const gapCs = centiseconds(cueWords[i + 1].start - word.end);
      if (gapCs > 0) text += `{\\k${gapCs}}`;
    }
  }
  return text;
}

/**
 * Render word-level timings as a full ASS document body with per-word
 * karaoke highlighting, ready to write to a .ass file and burn via
 * ffmpeg's subtitles filter (libass renders \k natively).
 *
 * @param {{word: string, start: number, end: number}[]} words
 * @param {object} [options] see DEFAULT_ASS_OPTIONS for every knob.
 * @returns {string}
 */
function buildKaraokeAss(words, options = {}) {
  const opts = { ...DEFAULT_ASS_OPTIONS, ...options };
  const cues = chunkWords(words, { wordsPerCue: opts.wordsPerCue, maxGapSec: opts.maxGapSec });

  // Alignment 2 = bottom-center; MarginV is then the distance from the
  // BOTTOM edge, so a top-measured verticalPosition inverts here.
  const marginV = Math.max(0, Math.round((1 - opts.verticalPosition) * opts.resolutionY));

  const header = [
    '[Script Info]',
    'Title: Stem Studio Karaoke Captions',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    `PlayResX: ${opts.resolutionX}`,
    `PlayResY: ${opts.resolutionY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, '
      + 'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, '
      + 'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,${opts.fontName},${opts.fontSize},${opts.primaryColour},${opts.secondaryColour},`
      + `${opts.outlineColour},${opts.backColour},${opts.bold ? -1 : 0},0,0,0,100,100,0,0,1,`
      + `${opts.outline},${opts.shadow},2,20,20,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = cues.map((cue) => {
    const text = buildKaraokeCueText(cue.words);
    return `Dialogue: 0,${toAssTimestamp(cue.start)},${toAssTimestamp(cue.end)},Karaoke,,0,0,0,,${text}`;
  });

  return `${header.join('\n')}\n${events.join('\n')}\n`;
}

function toSrtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function buildSrt(cues) {
  if (!Array.isArray(cues) || !cues.length) return '';
  const lines = [];
  cues.forEach((cue, index) => {
    lines.push(String(index + 1));
    lines.push(`${toSrtTimestamp(cue.start)} --> ${toSrtTimestamp(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  });
  return lines.join('\n');
}

module.exports = {
  DEFAULT_WORDS_PER_CUE,
  DEFAULT_MAX_GAP_SEC,
  DEFAULT_ASS_OPTIONS,
  chunkWords,
  centiseconds,
  escapeAssText,
  toAssTimestamp,
  buildKaraokeCueText,
  buildKaraokeAss,
  toSrtTimestamp,
  buildSrt,
};
