"""Local Whisper ASR via Hugging Face transformers.

Adapted from the Traxelio stem-asr service for offline use inside Stem Studio.
Writes transcript.txt / captions.vtt / asr.json next to the edit.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

DEFAULT_MODEL = "openai/whisper-large-v3"

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


def pick_device() -> tuple[str, object]:
    """Fastest available torch device for Whisper, with a dtype that suits it.

    large-v3 on CPU runs slower than realtime, so the default model is only
    usable if we actually reach the GPU when one exists.
    """
    try:
        import torch
    except ImportError:
        return "cpu", None

    if torch.backends.mps.is_available():
        return "mps", torch.float16
    if torch.cuda.is_available():
        return "cuda:0", torch.float16
    return "cpu", torch.float32


def _chunks_to_spans(chunks: list[dict]) -> list[dict]:
    """Shared timestamp-filling logic for both segment- and word-level chunks:
    a None start/end (pipeline gives up on a boundary) falls back to the
    previous span's end so downstream VTT/word timing never has a gap."""
    spans = []
    last_end = 0.0
    for chunk in chunks or []:
        start, end = chunk.get("timestamp") or (None, None)
        start = last_end if start is None else float(start)
        end = start if end is None else float(end)
        last_end = end
        text = (chunk.get("text") or "").strip()
        if text:
            spans.append({"start": start, "end": end, "text": text})
    return spans


def transcribe(audio_path: str, model: str | None = None, language: str | None = None) -> dict:
    """Run Whisper over one audio file. Returns {text, segments, words, language, model}.

    Two passes: one for segment-level chunks (feeds transcript.txt/captions.vtt,
    unchanged from before word timing existed) and one for word-level chunks
    (feeds asr.json's `words`, which a sibling caption lane depends on). The
    transformers ASR pipeline's return_timestamps switches its chunk grain
    between "segment" and "word" per call — there's no single call that
    returns both — so getting real word timing without changing the existing
    segment output means running inference twice.
    """
    try:
        from transformers import pipeline
    except ImportError as exc:
        raise RuntimeError(
            "missing Python deps for local ASR (pip3 install transformers torch)"
        ) from exc

    model_id = resolve_model(model)
    device, dtype = pick_device()
    pipeline_kwargs = {
        "chunk_length_s": 30,
        "device": device,
    }
    if dtype is not None:
        pipeline_kwargs["torch_dtype"] = dtype
    asr = pipeline("automatic-speech-recognition", model=model_id, **pipeline_kwargs)
    # condition_on_prev_tokens=False is the loop guard: conditioning each window
    # on its own previous output lets the decoder lock onto a filler phrase and
    # emit it for the rest of the file. That failure exits 0 and writes a
    # complete-looking transcript, so it has to be prevented, not detected.
    generate_kwargs = {"task": "transcribe", "condition_on_prev_tokens": False}
    if language:
        generate_kwargs["language"] = language

    out = asr(audio_path, return_timestamps=True, generate_kwargs=generate_kwargs)
    segments = _chunks_to_spans(out.get("chunks"))

    word_out = asr(audio_path, return_timestamps="word", generate_kwargs=generate_kwargs)
    words = _chunks_to_spans(word_out.get("chunks"))

    return {
        "text": (out.get("text") or "").strip(),
        "segments": segments,
        "words": words,
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
        "words": result.get("words") or [],
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
