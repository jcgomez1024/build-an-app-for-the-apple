#!/bin/bash
# restart1: the ONLY way to restart the Elvi API (launchd com.cocinaelvis.api; no file watching).
# Waits until no phone call is active/waiting AND no ordering-app session (typed/voice/checkout) had activity in the
# last ELVI_ORDER_IDLE_MIN minutes (default 5), then `launchctl kickstart -k`, then checks local + public health.
# restart2 (10/22): refuses to restart unless `tsc --noEmit` passes (the server runs src/ via tsx, so this is its build
#   check); prints errors and exits 3 without touching the running server. After restart polls /health up to
#   ELVI_HEALTH_WAIT (30s); if unhealthy, saves the bad src/ to the snapshot dir, restores the last known-good src/
#   (or git HEAD's src/ if none yet), restarts again and exits 4. A healthy restart saves src/ as the new known-good.
# Usage: scripts/safe-restart.sh [--check | --dry-run]
#   --check   : only report busy/idle (exit 0 idle / 1 busy)
#   --dry-run : run the compile gate and report what would happen; never restarts
# Test hooks (env, only with ELVI_RESTART_TEST=1): ELVI_RESTART_CMD, ELVI_HEALTH_URL, ELVI_SNAPSHOT_DIR, ELVI_SKIP_IDLE=1
cd "$(dirname "$0")/.." || exit 1
API_DIR=$(pwd)
# restart2b: test hooks only with ELVI_RESTART_TEST=1 (a leftover export once pointed a real restart at a fake service)
if [ "$ELVI_RESTART_TEST" != 1 ]; then
  for v in ELVI_RESTART_CMD ELVI_HEALTH_URL ELVI_SNAPSHOT_DIR ELVI_SKIP_IDLE ELVI_HEALTH_WAIT; do [ -n "${!v}" ] && echo "ignoring $v (set ELVI_RESTART_TEST=1 to use test hooks)"; unset $v; done
fi
IDLE_MIN=${ELVI_ORDER_IDLE_MIN:-5}; MAX_WAIT=${ELVI_RESTART_MAX_WAIT:-1800}
HEALTH_URL=${ELVI_HEALTH_URL:-http://localhost:4000/health}; HEALTH_WAIT=${ELVI_HEALTH_WAIT:-30}
SNAP=${ELVI_SNAPSHOT_DIR:-"$HOME/Library/Application Support/CocinaElvis/restart-snapshots"}
RESTART_CMD=${ELVI_RESTART_CMD:-"launchctl kickstart -k gui/$(id -u)/com.cocinaelvis.api"}
busy() {
  [ "$ELVI_SKIP_IDLE" = 1 ] && return 1
  local st; st=$(curl -s -m 5 localhost:4000/api/phone/state) || { echo "api down"; return 1; }
  if ! echo "$st" | grep -q '"active":\[\]'; then echo "call active"; return 0; fi
  if echo "$st" | grep -o '"waiting":\[[^]]' | grep -q .; then echo "call waiting"; return 0; fi
  local s; s=$(find data/logs/sessions -name '*.jsonl' -mmin -"$IDLE_MIN" 2>/dev/null | grep -Ev -- '-(call|rescore|probe|replay|expected|test|learn)' | head -1)
  if [ -n "$s" ]; then echo "order session active ($(basename "$s" | cut -c1-24)…)"; return 0; fi
  return 1
}
compile_gate() {
  local out; out=$(npx --no-install tsc --noEmit -p tsconfig.json 2>&1); local rc=$?
  if [ $rc -ne 0 ]; then echo "$out" | head -60; echo "REFUSED: type-check failed (tsc exit $rc) — running server untouched."; return 1; fi
  echo "compile gate: tsc OK"; return 0
}
healthy() { local i c; for i in $(seq 1 "$HEALTH_WAIT"); do sleep 1; c=$(curl -s -o /dev/null -w '%{http_code}' -m 2 "$HEALTH_URL"); [ "$c" = 200 ] && return 0; done; return 1; }
save_good() { mkdir -p "$SNAP"; rm -rf "$SNAP/last-good.tmp"; cp -R src "$SNAP/last-good.tmp" && git rev-parse --short HEAD > "$SNAP/last-good.tmp/.commit" 2>/dev/null; rm -rf "$SNAP/last-good"; mv "$SNAP/last-good.tmp" "$SNAP/last-good"; }

if [ "$1" = "--check" ]; then if r=$(busy); then echo "BUSY: $r"; exit 1; else echo "IDLE ${r:+($r)}"; exit 0; fi; fi
compile_gate || exit 3
if [ "$1" = "--dry-run" ]; then
  echo "DRY RUN: would wait for idle ($(r=$(busy) && echo "now BUSY: $r" || echo "now idle")), then: $RESTART_CMD; health $HEALTH_URL ≤${HEALTH_WAIT}s; rollback source: $([ -d "$SNAP/last-good" ] && echo "last-good ($(cat "$SNAP/last-good/.commit" 2>/dev/null))" || echo "git HEAD src/")"; exit 0
fi
waited=0
while r=$(busy); do echo "$(date +%T) waiting: $r"; sleep 10; waited=$((waited+10)); [ $waited -ge $MAX_WAIT ] && { echo "gave up after ${MAX_WAIT}s"; exit 2; }; done
compile_gate || exit 3   # files may have changed while waiting
echo "$(date +%T) idle → restarting"
$RESTART_CMD
if healthy; then
  save_good
  echo "local $(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH_URL") public $([ -z "$ELVI_HEALTH_URL" ] && curl -s -o /dev/null -w '%{http_code}' -m 10 https://elvi.cocinaelvis.app/health || echo skipped)"
  exit 0
fi
ts=$(date +%Y%m%d-%H%M%S); mkdir -p "$SNAP"; cp -R src "$SNAP/failed-$ts"
echo "$(date +%T) UNHEALTHY after ${HEALTH_WAIT}s → rolling back (bad src saved to $SNAP/failed-$ts)"
if [ -d "$SNAP/last-good" ]; then rsync -a --delete --exclude .commit "$SNAP/last-good/" src/; echo "restored last-good src ($(cat "$SNAP/last-good/.commit" 2>/dev/null))"
else git checkout HEAD -- src && echo "restored src from git HEAD ($(git rev-parse --short HEAD))"; fi
$RESTART_CMD
if healthy; then echo "ROLLED BACK: healthy again on the previous code. Fix and retry; your changes are in $SNAP/failed-$ts"; exit 4; fi
echo "ROLLBACK ALSO UNHEALTHY — check /tmp/elvi-api-dev.log"; exit 5
