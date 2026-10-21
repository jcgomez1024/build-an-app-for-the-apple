#!/bin/bash
# restart1: the ONLY way to restart the Elvi API (launchd com.cocinaelvis.api; no file watching).
# Waits until no phone call is active/waiting AND no ordering-app session (typed/voice/checkout) had activity in the
# last ELVI_ORDER_IDLE_MIN minutes (default 5), then `launchctl kickstart -k`, then checks local + public health.
# Usage: scripts/safe-restart.sh [--check]   (--check: only report busy/idle, exit 0 idle / 1 busy)
cd "$(dirname "$0")/.." || exit 1
IDLE_MIN=${ELVI_ORDER_IDLE_MIN:-5}; MAX_WAIT=${ELVI_RESTART_MAX_WAIT:-1800}
busy() {
  local st; st=$(curl -s -m 5 localhost:4000/api/phone/state) || { echo "api down"; return 1; }
  if ! echo "$st" | grep -q '"active":\[\]'; then echo "call active"; return 0; fi
  if echo "$st" | grep -o '"waiting":\[[^]]' | grep -q .; then echo "call waiting"; return 0; fi
  local s; s=$(find data/logs/sessions -name '*.jsonl' -mmin -"$IDLE_MIN" 2>/dev/null | grep -Ev -- '-(call|rescore|probe|replay|expected|test|learn)' | head -1)
  if [ -n "$s" ]; then echo "order session active ($(basename "$s" | cut -c1-24)…)"; return 0; fi
  return 1
}
if [ "$1" = "--check" ]; then if r=$(busy); then echo "BUSY: $r"; exit 1; else echo "IDLE ${r:+($r)}"; exit 0; fi; fi
waited=0
while r=$(busy); do echo "$(date +%T) waiting: $r"; sleep 10; waited=$((waited+10)); [ $waited -ge $MAX_WAIT ] && { echo "gave up after ${MAX_WAIT}s"; exit 2; }; done
echo "$(date +%T) idle → restarting"
launchctl kickstart -k "gui/$(id -u)/com.cocinaelvis.api"
for i in $(seq 1 30); do sleep 2; c=$(curl -s -o /dev/null -w '%{http_code}' -m 3 localhost:4000/health); [ "$c" = 200 ] && break; done
echo "local $(curl -s -o /dev/null -w '%{http_code}' -m 5 localhost:4000/health) public $(curl -s -o /dev/null -w '%{http_code}' -m 10 https://elvi.cocinaelvis.app/health)"
