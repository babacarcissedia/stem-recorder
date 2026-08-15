"""Local Whisper ASR via Hugging Face transformers.

Adapted from the Traxelio stem-asr service for offline use inside Stem Studio.
Writes transcript.txt / captions.vtt / asr.json next to the edit.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

DEFAULT_MODEL = "openai/whisper-base"

ALIASES = {
    "tiny": "openai/whisper-tiny",
    "base": "openai/whisper-base",
    "small": "openai/whisper-small",
    "medium": "openai/whisper-medium",
    "large": "openai/whisper-large-v3",
    "turbo": "openai/whisper-large-v3-turbo",
}


def resolve_model(name: str | None) -> str:
    name = (name or "").strip() or os.environ.get("STEM_ASR_WHISPER_MODEL", "") or DEFAULT_MODEL
    if name in ALIASES:
        return ALIASES[name]
    if "/" in name:
        return name
    return f"openai/whisper-{name}"


def transcribe(audio_path: str, model: str | None = None, language: str | None = None) -> dict:
    """Run Whisper over one audio file. Returns {text, segments, language, model}."""
    try:
        from transformers import pipeline
    except ImportError as exc:
        raise RuntimeError(
            "missing Python deps for local ASR (pip3 install transformers torch)"
        ) from exc

    model_id = resolve_model(model)
    asr = pipeline(
        "automatic-speech-recognition",
        model=model_id,
        chunk_length_s=30,
        return_timestamps=True,
    )
    generate_kwargs = {"task": "transcribe"}
    if language:
        generate_kwargs["language"] = language
    out = asr(audio_path, generate_kwargs=generate_kwargs)

    segments = []
    last_end = 0.0
    for chunk in out.get("chunks") or []:
        start, end = chunk.get("timestamp") or (None, None)
        start = last_end if start is None else float(start)
        end = start if end is None else float(end)
        last_end = end
        text = (chunk.get("text") or "").strip()
        if text:
            segments.append({"start": start, "end": end, "text": text})

    return {
        "text": (out.get("text") or "").strip(),
        "segments": segments,
        "language": language,
        "model": model_id,
    }


def vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(float(seconds) * 1000)))
    hours, rest = divmod(total_ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    secs, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def to_vtt(segments: list[dict]) -> str:
    lines = ["WEBVTT", ""]
    for seg in segments:
        lines.append(f"{vtt_timestamp(seg['start'])} --> {vtt_timestamp(seg['end'])}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines)


def write_outputs(out_dir: str, result: dict, source_file: str, provider: str = "local") -> dict:
    """Write transcript.txt, captions.vtt, asr.json into out_dir; return file paths."""
    os.makedirs(out_dir, exist_ok=True)
    transcript_path = os.path.join(out_dir, "transcript.txt")
    captions_path = os.path.join(out_dir, "captions.vtt")
    asr_path = os.path.join(out_dir, "asr.json")

    text = result.get("text") or "\n".join(s["text"] for s in result.get("segments") or [])
    with open(transcript_path, "w", encoding="utf-8") as fh:
        fh.write(text.strip() + "\n")
    with open(captions_path, "w", encoding="utf-8") as fh:
        fh.write(to_vtt(result.get("segments") or []))
    meta = {
        "provider": provider,
        "model": result.get("model"),
        "language": result.get("language"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceFile": source_file,
    }
    with open(asr_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
        fh.write("\n")

    return {
        "transcript": transcript_path,
        "captions": captions_path,
        "asr": asr_path,
        "segments": len(result.get("segments") or []),
    }
