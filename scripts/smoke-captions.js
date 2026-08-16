#!/usr/bin/env node
'use strict';

/**
 * Headless smoke for Edit-T2d caption burn-in: subtitles filter escaping +
 * placement in the PiP graph (pure string assertions), and the take-level
 * plumbing — resolveBurn with the VTT present/absent, and the light cue
 * edit rewriting captions.vtt + transcript.txt. No ffmpeg binary needed.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  subtitlesFilter, pipFilterGraph, freezeStillChain, hasSubtitlesFilter, findFfmpeg,
} = require('../lib/ffmpeg-util');
const {
  resolveBurn, updateCueText, writeOutputs, readTranscript, buildVtt,
} = require('../lib/transcribe');
const { normalizeManifest } = require('../lib/edit-manifest');
const { buildSrt, toSrtTimestamp } = require('../lib/captions');

// —— subtitlesFilter: quoted filename, libavfilter specials escaped ——
assert.strictEqual(
  subtitlesFilter('/takes/take-1/edit/captions.vtt'),
  "subtitles=filename='/takes/take-1/edit/captions.vtt'"
);
assert.strictEqual(
  subtitlesFilter("/od'd:path\\x/captions.vtt"),
  "subtitles=filename='/od\\'d\\:path\\\\x/captions.vtt'"
);

// —— pipFilterGraph: subtitles stage appended last, after the overlay ——
const plain = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24 });
const burned = pipFilterGraph({
  crop: null, cam: {}, pipWidth: 480, margin: 24, subtitlesPath: '/t/edit/captions.vtt',
});
assert.strictEqual(
  burned,
  '[0:v]null[base];[1:v]scale=w=480:h=-2[pip];[base][pip]overlay=x=W-w-24:y=H-h-24[ov];'
  + "[ov]subtitles=filename='/t/edit/captions.vtt'[v]"
);

// —— no subtitlesPath keeps the T2a/T2c graphs byte-for-byte ——
assert.strictEqual(pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, subtitlesPath: null }), plain);
const frozen = pipFilterGraph({ crop: null, cam: {}, pipWidth: 480, margin: 24, freezeDur: 1.5 });
assert.ok(frozen.endsWith(`[ov]${freezeStillChain(1.5)}[v]`));

// —— freeze + subtitles compose in order: still first, then the burn ——
const both = pipFilterGraph({
  crop: null, cam: {}, pipWidth: 480, margin: 24, freezeDur: 2, subtitlesPath: '/t/c.vtt',
});
assert.ok(both.endsWith(`[ov]${freezeStillChain(2)},${subtitlesFilter('/t/c.vtt')}[v]`));

// —— capability probe: a boolean per build (Apply skips the burn on false) ——
{
  const ffmpeg = findFfmpeg();
  if (ffmpeg) assert.strictEqual(typeof hasSubtitlesFilter(ffmpeg), 'boolean');
  assert.strictEqual(hasSubtitlesFilter('/nonexistent/ffmpeg-t2d-smoke'), false);
}

// —— manifest flag: only the explicit ON survives normalization ——
assert.strictEqual(normalizeManifest({ captions: { burn: true } }, 't', 10).captions.burn, true);
assert.strictEqual('captions' in normalizeManifest({ captions: { burn: false } }, 't', 10), false);
assert.strictEqual('captions' in normalizeManifest({}, 't', 10), false);

const srtCues = [
  { start: 0.5, end: 2, text: 'Hello world.' },
  { start: 3, end: 4.5, text: 'Second cue.' },
];
assert.strictEqual(
  buildSrt(srtCues),
  '1\n00:00:00,500 --> 00:00:02,000\nHello world.\n\n'
  + '2\n00:00:03,000 --> 00:00:04,500\nSecond cue.\n'
);

assert.strictEqual(
  buildSrt([{ start: 3599.25, end: 3601.75, text: 'Over the top.' }]),
  '1\n00:59:59,250 --> 01:00:01,750\nOver the top.\n'
);

assert.strictEqual(buildSrt([]), '');
assert.strictEqual(buildSrt(undefined), '');

assert.strictEqual(toSrtTimestamp(0), '00:00:00,000');
assert.strictEqual(toSrtTimestamp(3661.001), '01:01:01,001');

const agreementCues = [
  { start: 0, end: 1.234, text: 'One.' },
  { start: 3599.5, end: 3600.5, text: 'Two.' },
];
const vttOut = buildVtt(agreementCues);
const srtOut = buildSrt(agreementCues);
const vttTimeLines = vttOut.split('\n').filter((line) => line.includes('-->'));
const srtTimeLines = srtOut.split('\n').filter((line) => line.includes('-->'));
assert.strictEqual(vttTimeLines.length, srtTimeLines.length);
vttTimeLines.forEach((vttLine, index) => {
  const srtLine = srtTimeLines[index].replace(/,/g, '.');
  assert.strictEqual(vttLine, srtLine);
});
const vttTexts = agreementCues.map((cue) => cue.text);
const srtTexts = srtOut.trimEnd().split('\n\n').map((block) => block.split('\n').slice(2).join('\n'));
assert.deepStrictEqual(srtTexts, vttTexts);

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-captions-smoke-'));
  try {
    const takeDir = path.join(tmp, 'take-demo');
    fs.mkdirSync(takeDir, { recursive: true });

    // —— resolveBurn: default OFF · ON without a VTT skips · ON with a VTT burns ——
    assert.deepStrictEqual(resolveBurn(takeDir, { clips: [] }), { burn: false, requested: false });
    assert.deepStrictEqual(resolveBurn(takeDir, {}), { burn: false, requested: false });
    assert.deepStrictEqual(resolveBurn(takeDir, null), { burn: false, requested: false });
    assert.deepStrictEqual(
      resolveBurn(takeDir, { captions: { burn: false } }),
      { burn: false, requested: false }
    );
    const skipped = resolveBurn(takeDir, { captions: { burn: true } });
    assert.strictEqual(skipped.burn, false);
    assert.ok(/no captions\.vtt/.test(skipped.skipped));

    const written = writeOutputs(takeDir, {
      provider: 'local',
      model: 'whisper-base',
      language: 'en',
      sourceFile: 'audio.mp3',
      text: 'Hello world.\nSecond cue.',
      cues: [
        { start: 0.5, end: 2, text: 'Hello world.' },
        { start: 3, end: 4.5, text: 'Second cue.' },
      ],
    });
    assert.strictEqual(written.captionsSrt, path.join(takeDir, 'edit', 'captions.srt'));
    assert.strictEqual(
      fs.readFileSync(written.captionsSrt, 'utf8'),
      '1\n00:00:00,500 --> 00:00:02,000\nHello world.\n\n'
      + '2\n00:00:03,000 --> 00:00:04,500\nSecond cue.\n'
    );
    const live = resolveBurn(takeDir, { captions: { burn: true } });
    assert.strictEqual(live.burn, true);
    assert.strictEqual(live.vtt, path.join(takeDir, 'edit', 'captions.vtt'));

    const res = updateCueText(takeDir, 1, '  Second cue, fixed.  ');
    assert.strictEqual(res.segments, 2);
    assert.deepStrictEqual(res.cue, { start: 3, end: 4.5, text: 'Second cue, fixed.' });
    assert.strictEqual(res.captionsSrt, path.join(takeDir, 'edit', 'captions.srt'));
    assert.strictEqual(
      fs.readFileSync(res.captionsSrt, 'utf8'),
      '1\n00:00:00,500 --> 00:00:02,000\nHello world.\n\n'
      + '2\n00:00:03,000 --> 00:00:04,500\nSecond cue, fixed.\n'
    );
    const read = readTranscript(takeDir);
    assert.deepStrictEqual(read.cues, [
      { start: 0.5, end: 2, text: 'Hello world.' },
      { start: 3, end: 4.5, text: 'Second cue, fixed.' },
    ]);
    assert.strictEqual(read.text, 'Hello world.\nSecond cue, fixed.\n');

    // —— guard rails: bad index / empty text / missing VTT are clear errors ——
    assert.throws(() => updateCueText(takeDir, 2, 'x'), /out of range/);
    assert.throws(() => updateCueText(takeDir, -1, 'x'), /out of range/);
    assert.throws(() => updateCueText(takeDir, 0, '   '), /cannot be empty/);
    const bare = path.join(tmp, 'take-bare');
    fs.mkdirSync(bare, { recursive: true });
    assert.throws(() => updateCueText(bare, 0, 'x'), /no captions\.vtt/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, cases: 32 }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
