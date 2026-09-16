#!/usr/bin/env bash
# Build the Core Audio process-tap helper that lets the avatar hear another app.
#
# Deployment target is 14.4, not the app's 14.0: process taps did not exist
# before then. The app runs fine on 14.0 - AudioTap.available() simply reports
# false and singing along is the only thing missing - so the app's own minimum
# stays where it is.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source="$root/native/audio-tap/main.swift"
output="$root/build/native/gla-audio-tap"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-audio-tap: not macOS, skipping" >&2
  exit 0
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-audio-tap: swiftc not found; install the Xcode command line tools" >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
swiftc -O -swift-version 5 \
  -target "$(uname -m)-apple-macos14.4" \
  -framework AudioToolbox -framework CoreAudio -framework AppKit \
  -o "$output" "$source"

# A tap is refused outright without the audio-recording entitlement, and the
# helper is a separate binary, so it has to carry its own copy.
codesign --force --sign - \
  --entitlements "$root/build/entitlements.audio-tap.plist" \
  --options runtime "$output"

echo "build-audio-tap: $output"
"$output" --list >/dev/null && echo "build-audio-tap: helper responds"
