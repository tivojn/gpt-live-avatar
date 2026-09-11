#!/usr/bin/env bash
# Build the Mac DMG. With ~/.config/gpt-live-avatar/notarize.env present (App
# Store Connect API key: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER) the
# app and DMG are notarized and stapled by electron-builder; without it the
# DMG is only Developer ID signed and Gatekeeper asks the user to allow it.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${GLA_NOTARIZE_ENV:-$HOME/.config/gpt-live-avatar/notarize.env}"
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; echo "notarizing with API key $APPLE_API_KEY_ID"; else echo "no notarize.env: building an unnotarized DMG"; fi
npx electron-builder --mac dmg
for dmg in dist/*.dmg; do
  if [ -n "${APPLE_API_KEY_ID:-}" ]; then xcrun stapler validate "$dmg" && spctl -a -t open --context context:primary-signature -v "$dmg" || true; fi
done
