#!/bin/bash
# tunnel1: keep the cloudflared quick tunnel alive and Twilio pointed at it (run by launchd: com.cocinaelvis.tunnel).
# Starts cloudflared → waits for the trycloudflare URL → node scripts/twilio-point-to-tunnel.mjs <url>.
# Every 60 s checks <url>/health; 3 failures in a row (or cloudflared exiting) → restart + repoint.
API_DIR="/Users/carlos/CocinaElvis/app/services/api"
NODE="${NODE:-/opt/homebrew/bin/node}"
CF="${CF:-/opt/homebrew/bin/cloudflared}"
LOG=/tmp/cf-tunnel.log
KLOG=/tmp/tunnel-keeper.log
say() { echo "$(date '+%F %T') $*" >> "$KLOG"; }
while true; do
  pkill -f "cloudflared tunnel --url http://localhost:4000" 2>/dev/null; sleep 1
  : > "$LOG"
  "$CF" tunnel --no-autoupdate --url http://localhost:4000 >> "$LOG" 2>&1 &
  CFPID=$!
  URL=""
  for i in $(seq 1 60); do URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1); [ -n "$URL" ] && break; sleep 1; done
  if [ -z "$URL" ]; then say "no URL from cloudflared; retrying"; kill $CFPID 2>/dev/null; sleep 15; continue; fi
  # wait until the new hostname actually answers, then repoint Twilio
  for i in $(seq 1 30); do [ "$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$URL/health")" = "200" ] && break; sleep 3; done
  if (cd "$API_DIR" && "$NODE" scripts/twilio-point-to-tunnel.mjs "$URL" >> "$KLOG" 2>&1); then say "pointed Twilio at $URL"; echo "$URL" > "$HOME/Library/Application Support/CocinaElvis/current-url.txt"; else say "repoint FAILED for $URL"; fi
  FAILS=0
  while kill -0 $CFPID 2>/dev/null; do
    sleep 60
    code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL/health")
    if [ "$code" = "200" ]; then FAILS=0; else FAILS=$((FAILS+1)); say "health $code ($FAILS/3) $URL"; fi
    [ $FAILS -ge 3 ] && { say "tunnel dead, restarting"; kill $CFPID 2>/dev/null; break; }
  done
  say "cloudflared stopped; restarting in 5 s"; sleep 5
done
