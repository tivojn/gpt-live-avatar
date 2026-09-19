#!/bin/bash
# The whole voice-system x action-engine matrix (qa/action-matrix-app.cjs). Real services, real engines, about an hour.
# Usage: bash qa/action-matrix.sh [results.jsonl] ["openai gemini gemini-thinking"] ["none codex openclaw hermes grok enconvo"]
cd "$(dirname "$0")/.." || exit 1
OUT="${1:-build/qa-action-matrix/results.jsonl}"; VOICES="${2:-openai gemini gemini-thinking}"; ENGINES="${3:-none codex openclaw hermes grok enconvo}"
mkdir -p "$(dirname "$OUT")"; : > "$OUT"
for voice in $VOICES; do for engine in $ENGINES; do
  line=$(env -u ELECTRON_RUN_AS_NODE npx electron qa/action-matrix-app.cjs --live --voice=$voice --engine=$engine 2>&1 | grep '^RESULT ' | cut -c8-)
  [ -z "$line" ] && line="{\"voice\":\"$voice\",\"engine\":\"$engine\",\"failure\":\"no result\"}"
  echo "$line" >> "$OUT"; echo "$voice / $engine: $(echo "$line" | python3 -c 'import sys,json;d=json.load(sys.stdin);c=d.get("create",{});x=d.get("remove",{});print("create",("OK "+str(c.get("fileMs"))+"ms") if c.get("ok") else "NO","| delete",("OK "+str(x.get("fileMs"))+"ms") if x.get("ok") else "NO",(d.get("failure") or "")[:80])')"
done; done
