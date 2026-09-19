#!/bin/bash
# The whole voice-system x action-engine matrix (qa/action-matrix-app.cjs). Real services, real engines, about an hour.
# Usage: bash qa/action-matrix.sh [results.jsonl] ["openai gemini gemini-thinking"] ["none codex openclaw hermes grok enconvo"]
cd "$(dirname "$0")/.." || exit 1
OUT="${1:-build/qa-action-matrix/results.jsonl}"; VOICES="${2:-openai gemini gemini-thinking}"; ENGINES="${3:-none codex openclaw hermes grok enconvo}"
mkdir -p "$(dirname "$OUT")"; : > "$OUT"
for voice in $VOICES; do for engine in $ENGINES; do
  for step in create remove; do
    line=$(env -u ELECTRON_RUN_AS_NODE npx electron qa/action-matrix-app.cjs --live --step=$step --voice=$voice --engine=$engine 2>&1 | grep '^RESULT ' | cut -c8-)
    [ -z "$line" ] && line="{\"voice\":\"$voice\",\"engine\":\"$engine\",\"step\":\"$step\",\"failure\":\"no result\"}"
    echo "$line" >> "$OUT"; echo "$voice / $engine / $step: $(echo "$line" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("OK" if d.get("ok") else "NO", d.get("fileMs"), (d.get("failure") or "")[:80])')"
    # nothing to delete when nothing was created
    [ "$step" = create ] && ! echo "$line" | grep -q '"ok":true' && break
  done
done; done
