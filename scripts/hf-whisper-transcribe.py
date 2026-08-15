#!/usr/bin/env python3
"""CLI wrapper around hf_whisper: transcribe one audio file into an out dir.

Usage:
  python3 scripts/hf-whisper-transcribe.py AUDIO --out-dir DIR [--model M] [--language L] [--source-name N]

Writes transcript.txt / captions.vtt / asr.json into --out-dir and prints a
JSON summary on stdout ({"ok": true, ...} or {"ok": false, "error": ...}).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hf_whisper  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Local Whisper transcription (Hugging Face)")
    parser.add_argument("audio", help="path to audio file (mp3/wav/m4a)")
    parser.add_argument("--out-dir", required=True, help="directory for transcript.txt / captions.vtt / asr.json")
    parser.add_argument("--model", default=None, help="HF model id or alias (base/small/…)")
    parser.add_argument("--language", default=None, help="ISO language hint, e.g. en / fr")
    parser.add_argument("--source-name", default=None, help="original stem name recorded in asr.json")
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({"ok": False, "error": f"audio not found: {args.audio}"}))
        return 1

    try:
        result = hf_whisper.transcribe(args.audio, model=args.model, language=args.language)
        files = hf_whisper.write_outputs(
            args.out_dir,
            result,
            args.source_name or os.path.basename(args.audio),
        )
    except Exception as exc:  # surfaced verbatim to the Electron main process
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1

    print(json.dumps({"ok": True, "model": result["model"], "language": result["language"], **files}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
