#!/usr/bin/env bash
# Fetch the assets the apps bundle from this repository's assets-v1 release:
#   build/assets/bundle/tia   Mac resource-friendly Tia package (Resources/avatars/tia)
#   build/assets/index.json   catalogue shipped with the apps
#   ios/Resources/model.glb   iOS 1K Tia model
#   ios/Resources/assets-index.json
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://github.com/tivojn/gpt-live-avatar/releases/download/assets-v1"
mkdir -p build/assets/bundle build/assets/ios ios/Resources
fetch() { echo "-> $1"; curl -fL --progress-bar "$BASE/$1" -o "$2"; }
fetch index.json build/assets/index.json
cp build/assets/index.json ios/Resources/assets-index.json
if [ ! -f build/assets/bundle/tia/manifest.json ]; then
  fetch tia-bundle.zip build/assets/tia-bundle.zip
  rm -rf build/assets/bundle/tia && (cd build/assets/bundle && unzip -q ../tia-bundle.zip) && rm build/assets/tia-bundle.zip
fi
if [ ! -f ios/Resources/model.glb ]; then
  fetch tia-1k.glb ios/Resources/model.glb
  cp ios/Resources/model.glb build/assets/ios/tia-1k.glb
fi
echo "assets ready"
