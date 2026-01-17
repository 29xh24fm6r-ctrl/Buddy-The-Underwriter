#!/usr/bin/env bash
set -euo pipefail

# CI-friendly build wrapper:
# - prints periodic heartbeat (prevents idle timeout)
# - captures timestamps + resource snapshots
# - logs last known build phase
# - exits with the real build exit code

export NEXT_TELEMETRY_DISABLED=1
export TURBO_TELEMETRY_DISABLED=1
export VERCEL_TELEMETRY_DISABLED=1
export CI=1

LOG_DIR="${LOG_DIR:-.ci}"
mkdir -p "$LOG_DIR"

PHASE_FILE="$LOG_DIR/last_phase.txt"
OUT_LOG="$LOG_DIR/build.out.log"
SYS_LOG="$LOG_DIR/build.sys.log"

echo "START $(date -Is)" | tee "$PHASE_FILE"
echo "node=$(node -v) pnpm=$(pnpm -v)" | tee "$SYS_LOG"
echo "uname=$(uname -a)" | tee -a "$SYS_LOG"
echo "nproc=$(nproc 2>/dev/null || echo '?')" | tee -a "$SYS_LOG"
echo "mem:" | tee -a "$SYS_LOG"
free -h 2>/dev/null | tee -a "$SYS_LOG" || true
echo "ulimit:" | tee -a "$SYS_LOG"
ulimit -a | tee -a "$SYS_LOG" || true
echo "----" | tee -a "$SYS_LOG"

heartbeat() {
  while true; do
    echo "[heartbeat $(date -Is)] building... last_phase=$(cat "$PHASE_FILE" 2>/dev/null || echo '?')" || true
    sleep 15
  done
}

capture_phase() {
  local line="$1"
  if echo "$line" | grep -q "Creating an optimized production build"; then
    echo "PHASE optimized_production_build $(date -Is)" > "$PHASE_FILE"
  elif echo "$line" | grep -q "Compiled successfully"; then
    echo "PHASE compiled_successfully $(date -Is)" > "$PHASE_FILE"
  elif echo "$line" | grep -q "Collecting page data"; then
    echo "PHASE collecting_page_data $(date -Is)" > "$PHASE_FILE"
  elif echo "$line" | grep -q "Generating static pages"; then
    echo "PHASE generating_static_pages $(date -Is)" > "$PHASE_FILE"
  fi
}

heartbeat &
HB_PID=$!

cleanup() {
  kill "$HB_PID" 2>/dev/null || true
}
trap cleanup EXIT

set +e
pnpm -s build 2>&1 | while IFS= read -r line; do
  echo "[$(date -Is)] $line" | tee -a "$OUT_LOG"
  capture_phase "$line"
done
code=${PIPESTATUS[0]}
set -e

echo "EXIT_CODE $code $(date -Is)" | tee -a "$SYS_LOG"
echo "LAST_PHASE $(cat "$PHASE_FILE" 2>/dev/null || echo '?')" | tee -a "$SYS_LOG"

exit "$code"
