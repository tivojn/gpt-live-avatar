#!/usr/bin/env bash
# Build the Mac DMG. With ~/.config/gpt-live-avatar/notarize.env present (App
# Store Connect API key: APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER) the
# app and DMG are notarized and stapled by electron-builder; without it the
# DMG is only Developer ID signed and Gatekeeper asks the user to allow it.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${GLA_NOTARIZE_ENV:-$HOME/.config/gpt-live-avatar/notarize.env}"
if [ -f "$ENV_FILE" ]; then . "$ENV_FILE"; echo "Building with Apple notarization."; else echo "no notarize.env: building an unnotarized DMG"; fi
npx electron-builder --mac dmg
# electron-builder notarizes and staples the .app; the DMG container needs its
# own ticket so Gatekeeper accepts it before the app is even copied out.
BUILD_VERSION="$(node -p 'require("./package.json").version')"
for dmg in "dist/GPT-Live Avatar-${BUILD_VERSION}"*.dmg; do
  [ -f "$dmg" ] || continue
  if [ -n "${APPLE_API_KEY_ID:-}" ]; then
    xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
    xcrun stapler staple "$dmg"
    spctl -a -t open --context context:primary-signature -vv "$dmg"
  fi
done
