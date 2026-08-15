#!/usr/bin/env node
'use strict';

/** Transcribe plumbing smoke — VTT parse/build + audio resolution. No Whisper call. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseVttCues,
  buildVtt,
  writeOutputs,
  readTranscript,
  resolveAudio,
} = require('../lib/transcribe');

async function main() {
  {
    const vtt = [
      'WEBVTT',
      '',
      'NOTE generated locally',
      '',
      '00:00:00.000 --> 00:00:02.500',
      'Hello there.',
      '',
      'cue-2',
      '00:01:02.250 --> 01:00:03.000',
      'Two lines',
      'of text.',
      '',
    ].join('\n');
    const cues = parseVttCues(vtt);
    assert.strictEqual(cues.length, 2);
    assert.deepStrictEqual(cues[0], { start: 0, end: 2.5, text: 'Hello there.' });
    assert.strictEqual(cues[1].start, 62.25);
    assert.strictEqual(cues[1].end, 3603);
    assert.strictEqual(cues[1].text, 'Two lines\nof text.');
  }

  {
    const cues = [
      { start: 0, end: 1.25, text: 'a' },
      { start: 90.5, end: 3601.001, text: 'b' },
    ];
    const roundTrip = parseVttCues(buildVtt(cues));
    assert.deepStrictEqual(roundTrip, cues);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-asr-smoke-'));
  try {
    const takeDir = path.join(tmp, 'take-demo');
    fs.mkdirSync(takeDir, { recursive: true });

    // No audio.mp3 and no screen.mp4 → clear error.
    await assert.rejects(resolveAudio(takeDir), /no audio\.mp3 or screen\.mp4/);

    // audio.mp3 preferred, no demux.
    fs.writeFileSync(path.join(takeDir, 'audio.mp3'), 'fake');
    const audio = await resolveAudio(takeDir);
    assert.strictEqual(audio.path, path.join(takeDir, 'audio.mp3'));
    assert.strictEqual(audio.demuxed, false);
    assert.strictEqual(audio.sourceFile, 'audio.mp3');

    // writeOutputs + readTranscript round-trip.
    const files = writeOutputs(takeDir, {
      provider: 'cloud',
      model: 'traxelio-asr',
      language: 'en',
      sourceFile: 'audio.mp3',
      text: 'Hello world.',
      cues: [{ start: 0.5, end: 2, text: 'Hello world.' }],
    });
    assert.strictEqual(files.segments, 1);
    const read = readTranscript(takeDir);
    assert.strictEqual(read.text.trim(), 'Hello world.');
    assert.deepStrictEqual(read.cues, [{ start: 0.5, end: 2, text: 'Hello world.' }]);
    assert.strictEqual(read.asr.provider, 'cloud');
    assert.strictEqual(read.asr.sourceFile, 'audio.mp3');
    assert.ok(read.asr.createdAt);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, cases: 5 }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
