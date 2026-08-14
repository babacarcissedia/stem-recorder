#!/usr/bin/env bash
# Triple record: screen + webcam + audio as separate files in one folder.
# Usage:
#   ./dual-record.sh list
#   ./dual-record.sh start
#   ./dual-record.sh stop
#   ./dual-record.sh status
#
# Env overrides (indexes from `list` — they shift when Continuity/OBS appear):
#   SCREEN_DEV  CAM_DEV  MIC_DEV  OUT_DIR  FRAMERATE
set -euo pipefail

OUT_DIR="${OUT_DIR:-$HOME/Movies/frontier-models-recording}"
PID_DIR="$OUT_DIR/.pids"
FRAMERATE="${FRAMERATE:-30}"
mkdir -p "$OUT_DIR" "$PID_DIR"

# Defaults measured 2026-08-14 evening (re-run list before every take):
#   video [0] BCD XVII Bro Camera          ← Continuity phone
#   video [1] MacBook Pro Camera
#   video [2] OBS Virtual Camera
#   video [5] Capture screen 0
#   audio [0] BCD XVII Bro Microphone
#   audio [1] MacBook Pro Microphone
#   audio [2] DJI MIC MINI
SCREEN_DEV="${SCREEN_DEV:-5}"
CAM_DEV="${CAM_DEV:-0}"
MIC_DEV="${MIC_DEV:-0}"

list_devices() {
  ffmpeg -f avfoundation -list_devices true -i "" 2>&1 | sed -n '/AVFoundation/,$p' || true
}

usage() {
  cat <<EOF
Usage: $0 {start|stop|list|status}

Records three separate files into one take folder:
  screen-*.mp4   display (cursor on, no audio)
  cam-*.mp4      Continuity / webcam (no audio)
  audio-*.m4a    mic only

  SCREEN_DEV=$SCREEN_DEV  CAM_DEV=$CAM_DEV  MIC_DEV=$MIC_DEV
  OUT_DIR=$OUT_DIR

Cam framing preview (optional): cam-preview.html via python3 -m http.server 8765
Screen is NOT previewed in HTML — open slides.html in Cursor, then start this script.
EOF
}

write_manifest() {
  local stamp="$1"
  local take_dir="$2"
  cat >"$take_dir/manifest.txt" <<EOF
stamp=$stamp
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
screen_dev=$SCREEN_DEV
cam_dev=$CAM_DEV
mic_dev=$MIC_DEV
screen=$take_dir/screen.mp4
cam=$take_dir/cam.mp4
audio=$take_dir/audio.m4a
EOF
}

start() {
  if [[ -f "$PID_DIR/screen.pid" || -f "$PID_DIR/cam.pid" || -f "$PID_DIR/audio.pid" ]]; then
    echo "Already recording. Run: $0 stop" >&2
    exit 1
  fi

  local stamp take_dir
  stamp="$(date +%Y%m%d-%H%M%S)"
  take_dir="$OUT_DIR/take-$stamp"
  mkdir -p "$take_dir"
  echo "$stamp" >"$PID_DIR/stamp"
  echo "$take_dir" >"$PID_DIR/take_dir"

  echo "=== devices (confirm indexes) ==="
  list_devices
  echo
  echo "=== starting take $stamp ==="
  echo "  SCREEN_DEV=$SCREEN_DEV → $take_dir/screen.mp4"
  echo "  CAM_DEV=$CAM_DEV       → $take_dir/cam.mp4"
  echo "  MIC_DEV=$MIC_DEV       → $take_dir/audio.m4a"
  echo

  write_manifest "$stamp" "$take_dir"

  # Screen — video only
  ffmpeg -hide_banner -y -f avfoundation -framerate "$FRAMERATE" -capture_cursor 1 \
    -i "${SCREEN_DEV}:none" \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -an \
    "$take_dir/screen.mp4" >"$take_dir/screen.ffmpeg.log" 2>&1 &
  echo $! >"$PID_DIR/screen.pid"

  # Webcam / Continuity — video only (separate from mic)
  ffmpeg -hide_banner -y -f avfoundation -framerate "$FRAMERATE" \
    -i "${CAM_DEV}:none" \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -an \
    "$take_dir/cam.mp4" >"$take_dir/cam.ffmpeg.log" 2>&1 &
  echo $! >"$PID_DIR/cam.pid"

  # Mic — audio only → mp3 when ffmpeg available; else m4a
  local audio_out="$take_dir/audio.mp3"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -hide_banner -y -f avfoundation \
      -i ":${MIC_DEV}" \
      -c:a libmp3lame -b:a 192k \
      "$audio_out" >"$take_dir/audio.ffmpeg.log" 2>&1 &
  else
    audio_out="$take_dir/audio.m4a"
    ffmpeg -hide_banner -y -f avfoundation \
      -i ":${MIC_DEV}" \
      -c:a aac -b:a 192k \
      "$audio_out" >"$take_dir/audio.ffmpeg.log" 2>&1 &
  fi
  echo $! >"$PID_DIR/audio.pid"

  sleep 1.5
  local failed=0
  for name in screen cam audio; do
    if ! kill -0 "$(cat "$PID_DIR/$name.pid")" 2>/dev/null; then
      echo "$name capture failed. See $take_dir/$name.ffmpeg.log" >&2
      tail -40 "$take_dir/$name.ffmpeg.log" >&2 || true
      failed=1
    fi
  done
  if [[ "$failed" -ne 0 ]]; then
    "$0" stop || true
    exit 1
  fi

  echo "RECORDING take-$stamp"
  echo "  screen pid $(cat "$PID_DIR/screen.pid")"
  echo "  cam    pid $(cat "$PID_DIR/cam.pid")"
  echo "  audio  pid $(cat "$PID_DIR/audio.pid")"
  echo "  folder $take_dir"
  echo "When done: $0 stop"
  echo "Tip: put slides.html in fullscreen in Cursor before / during the take."
}

stop() {
  local take_dir=""
  [[ -f "$PID_DIR/take_dir" ]] && take_dir="$(cat "$PID_DIR/take_dir")"

  for name in screen cam audio; do
    if [[ -f "$PID_DIR/$name.pid" ]]; then
      local pid
      pid="$(cat "$PID_DIR/$name.pid")"
      if kill -0 "$pid" 2>/dev/null; then
        kill -INT "$pid" 2>/dev/null || true
        # Give ffmpeg time to finalize mp4/m4a
        for _ in 1 2 3 4 5 6 7 8 9 10; do
          kill -0 "$pid" 2>/dev/null || break
          sleep 0.3
        done
        kill -KILL "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
      rm -f "$PID_DIR/$name.pid"
    fi
  done
  rm -f "$PID_DIR/stamp" "$PID_DIR/take_dir"

  if [[ -n "$take_dir" && -d "$take_dir" ]]; then
    {
      echo "stopped_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "sizes:"
      ls -lh "$take_dir"/screen.mp4 "$take_dir"/cam.mp4 "$take_dir"/audio.m4a 2>/dev/null || true
    } >>"$take_dir/manifest.txt"
    echo "Stopped. Take folder:"
    ls -lh "$take_dir"/*.{mp4,m4a} 2>/dev/null || ls -lh "$take_dir"
    echo "Full path: $take_dir"
  else
    echo "Stopped. Recent takes:"
    ls -ltd "$OUT_DIR"/take-* 2>/dev/null | head -5 || echo "(none yet)"
  fi
}

status() {
  if [[ -f "$PID_DIR/screen.pid" || -f "$PID_DIR/cam.pid" || -f "$PID_DIR/audio.pid" ]]; then
    echo "recording"
    [[ -f "$PID_DIR/take_dir" ]] && echo "  take $(cat "$PID_DIR/take_dir")"
    for name in screen cam audio; do
      [[ -f "$PID_DIR/$name.pid" ]] && echo "  $name pid $(cat "$PID_DIR/$name.pid")"
    done
  else
    echo "idle"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  list|devices) list_devices ;;
  status) status ;;
  *)
    usage
    exit 1
    ;;
esac
