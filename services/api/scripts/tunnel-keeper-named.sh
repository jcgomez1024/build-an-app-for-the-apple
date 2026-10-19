#!/bin/bash
# named1: run the named tunnel "elvi" (https://elvi.cocinaelvis.app → localhost:4000), point Twilio there once,
# health-check every 60 s; 3 fails in a row → restart it; if it can't come back healthy, fall back to the quick tunnel keeper.
API_DIR="/Users/carlos/CocinaElvis/app/services/api"
NODE="/opt/homebrew/bin/node"; CF="/opt/homebrew/bin/cloudflared"
URL="https://elvi.cocinaelvis.app"
S="$HOME/Library/Application Support/CocinaElvis"
LOG=/tmp/cf-named.log; KLOG=/tmp/tunnel-keeper.log
say() { echo "$(date '+%F %T') [named] $*" >> "$KLOG"; }
ok() { [ "$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL/health")" = "200" ]; }
pointed=""
while true; do
  pkill -f "cloudflared tunnel --url http://localhost:4000" 2>/dev/null
  pkill -f "cloudflared.*tunnel run elvi" 2>/dev/null; sleep 1
  "$CF" tunnel --no-autoupdate run elvi >> "$LOG" 2>&1 &
  CFPID=$!
  up=""; for i in $(seq 1 40); do ok && { up=1; break; }; sleep 3; done
  if [ -z "$up" ]; then
    say "named tunnel not healthy after 2 min → quick-tunnel fallback for 30 min"
    kill $CFPID 2>/dev/null; pointed=""
    /bin/bash "$S/tunnel-keeper.sh" & QK=$!; sleep 1800; kill $QK 2>/dev/null
    continue
  fi
  if [ -z "$pointed" ]; then
    if (cd "$API_DIR" && "$NODE" scripts/twilio-point-to-tunnel.mjs "$URL" >> "$KLOG" 2>&1); then pointed=1; say "pointed Twilio at $URL"; echo "$URL" > "$S/current-url.txt"; else say "repoint FAILED"; fi
  fi
  FAILS=0
  while kill -0 $CFPID 2>/dev/null; do
    sleep 60
    if ok; then FAILS=0; else FAILS=$((FAILS+1)); say "health fail ($FAILS/3)"; fi
    [ $FAILS -ge 3 ] && { say "named tunnel dead, restarting"; kill $CFPID 2>/dev/null; break; }
  done
  sleep 5
done
