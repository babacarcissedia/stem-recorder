#!/usr/bin/env node
'use strict';

/**
 * Transcribe plumbing smoke — VTT parse/build, audio resolution, cue
 * verification, and provider registry resolution. Providers are mocked
 * throughout: this never calls a real ASR backend (no Whisper, no network).
 */

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
  runLocal,
  runCloud,
} = require('../lib/transcribe');
const { verifyTranscript, LOOP_RUN_THRESHOLD } = require('../lib/asr/verify');
const registry = require('../lib/asr/registry');

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

  // —— B1: verifyTranscript — clean / looped / scattered-tic / short-coverage ——
  {
    // Clean: cues cover the audio, no run reaches the loop threshold.
    const cues = [
      { start: 0, end: 2, text: 'Hello there.' },
      { start: 2, end: 4, text: 'How are you.' },
      { start: 4, end: 6, text: 'Doing fine.' },
      { start: 6, end: 8, text: 'Thanks for asking.' },
    ];
    const v = verifyTranscript(cues, 8);
    assert.strictEqual(v.ok, true);
    assert.deepStrictEqual(v.reasons, []);
    assert.strictEqual(v.repetition.loop, false);
    assert.strictEqual(v.coverage.short, false);
  }
  {
    // Looped: a decoder locking onto "Yeah" for most of the file — the
    // 2026-08-15 whisper-large-v3 failure, reproduced in miniature.
    const cues = [
      { start: 0, end: 2, text: 'Real speech opens the take.' },
      { start: 2, end: 4, text: 'Still coherent here.' },
      ...Array.from({ length: 20 }, (_, i) => ({ start: 4 + i * 2, end: 6 + i * 2, text: 'Yeah.' })),
    ];
    const duration = 4 + 20 * 2;
    const v = verifyTranscript(cues, duration);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.repetition.loop, true);
    assert.ok(v.repetition.longestRun >= LOOP_RUN_THRESHOLD);
    assert.strictEqual(v.repetition.longestRunText, 'Yeah.');
    assert.ok(v.reasons.some((r) => r.startsWith('repetition:')));
    assert.strictEqual(v.coverage.short, false); // cues do cover the full duration
  }
  {
    // Scattered tic: "Okay." recurs across a long take but never runs more
    // than 2 in a row — a speaker's verbal habit, not a stuck decoder.
    const cues = [];
    for (let i = 0; i < 30; i += 1) {
      cues.push({ start: i * 60, end: i * 60 + 55, text: `Segment number ${i}.` });
      if (i % 5 === 0) cues.push({ start: i * 60 + 55, end: i * 60 + 57, text: 'Okay.' });
    }
    const duration = 30 * 60;
    const v = verifyTranscript(cues, duration);
    assert.strictEqual(v.ok, true, `expected clean, got: ${v.reasons.join('; ')}`);
    assert.strictEqual(v.repetition.loop, false);
    assert.ok(v.repetition.repeatedTexts >= 1); // "Okay." does repeat — just not consecutively
    assert.ok(v.repetition.longestRun < LOOP_RUN_THRESHOLD);
  }
  {
    // Short coverage: the transcript stops well before the audio ends, with
    // no repetition involved — a distinct failure mode from a loop.
    const cues = [
      { start: 0, end: 100, text: 'The first third of the recording.' },
    ];
    const v = verifyTranscript(cues, 600);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.coverage.short, true);
    assert.strictEqual(v.repetition.loop, false);
    assert.ok(v.reasons.some((r) => r.startsWith('coverage:')));
  }
  {
    // No probed duration (ffprobe unavailable) → coverage never flags.
    const v = verifyTranscript([{ start: 0, end: 1, text: 'x' }], null);
    assert.strictEqual(v.coverage.short, false);
    assert.strictEqual(v.coverage.audioDurationSec, null);
  }

  // —— B3: provider registry — runLocal/runCloud resolve through the
  // registry and never call a real backend; both mocked here. ——
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-asr-smoke2-'));
  try {
    // runCloud: mock invoke() returns raw {model, language, text, cues};
    // runCloud itself still writes transcript.txt/captions.vtt/asr.json and
    // attaches verification.
    const cloudTakeDir = path.join(tmp2, 'take-cloud');
    fs.mkdirSync(cloudTakeDir, { recursive: true });
    fs.writeFileSync(path.join(cloudTakeDir, 'audio.mp3'), 'fake');
    const loopedCues = [
      { start: 0, end: 2, text: 'Intro line.' },
      ...Array.from({ length: 12 }, (_, i) => ({ start: 2 + i * 2, end: 4 + i * 2, text: 'Yeah.' })),
    ];
    const unstubCloud = registry.stub('cloud', {
      wordTimestamps: false,
      languages: 'auto',
      relativeSpeed: 'fast',
      async invoke() {
        return { model: 'mock-cloud', language: 'en', text: 'Intro line.\nYeah.', cues: loopedCues };
      },
    });
    let cloudResult;
    try {
      cloudResult = await runCloud({ takeDir: cloudTakeDir });
    } finally {
      unstubCloud();
    }
    assert.strictEqual(cloudResult.provider, 'cloud');
    assert.ok(cloudResult.verification);
    assert.strictEqual(cloudResult.verification.ok, false);
    assert.strictEqual(cloudResult.verification.repetition.loop, true);
    assert.strictEqual(fs.existsSync(cloudResult.transcript), true);
    assert.strictEqual(fs.existsSync(cloudResult.captions), true);
    const cloudAsr = JSON.parse(fs.readFileSync(cloudResult.asr, 'utf8'));
    assert.strictEqual(cloudAsr.verification.ok, false); // merged onto disk, not just in-memory

    // runLocal: mock invoke() writes files itself (as the real Python CLI
    // does) and returns the same file-path summary shape.
    const localTakeDir = path.join(tmp2, 'take-local');
    fs.mkdirSync(localTakeDir, { recursive: true });
    fs.writeFileSync(path.join(localTakeDir, 'audio.mp3'), 'fake');
    const cleanCues = [
      { start: 0, end: 2, text: 'Hello there.' },
      { start: 2, end: 4, text: 'Goodbye now.' },
    ];
    const unstubLocal = registry.stub('local', {
      wordTimestamps: true,
      languages: 'auto',
      relativeSpeed: 'slow',
      DEFAULT_MODEL: 'mock/whisper',
      findPython: () => '/usr/bin/python3',
      asrStatus: () => ({ localPythonOk: true, hasTransformers: true, python: '/usr/bin/python3' }),
      async invoke({ editDir }) {
        const files = writeOutputs(localTakeDir, {
          provider: 'local', model: 'mock/whisper', language: 'en', sourceFile: 'audio.mp3', text: 'Hello there.\nGoodbye now.', cues: cleanCues,
        });
        assert.strictEqual(path.dirname(files.transcript), editDir);
        return {
          ok: true, model: 'mock/whisper', language: 'en', ...files,
        };
      },
    });
    let localResult;
    try {
      localResult = await runLocal({ takeDir: localTakeDir });
    } finally {
      unstubLocal();
    }
    assert.strictEqual(localResult.provider, 'local');
    assert.strictEqual(localResult.verification.ok, true);
    assert.strictEqual(localResult.segments, 2);
  } finally {
    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, cases: 13 }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
