#!/bin/bash
# Builds "ToneLab SE Editor.app" for this Mac (Apple Silicon or Intel).
# Needs Node.js (https://nodejs.org, or `brew install node`). Run from Terminal:
#   bash scripts/build-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (LTS) or run: brew install node" >&2
  exit 1
fi

ARCH=$(uname -m)
[ "$ARCH" = "arm64" ] || ARCH=x64

npm install --no-fund --no-audit
node scripts/package.js darwin "$ARCH" dist

APP="dist/ToneLab SE Editor-darwin-$ARCH/ToneLab SE Editor.app"
# Apple Silicon only runs signed code: give the bundle an ad-hoc signature,
# and drop the quarantine flag so Gatekeeper doesn't block a locally built app.
codesign --force --deep --sign - "$APP"
xattr -cr "$APP"

echo
echo "Built: $APP"
echo "Drag it into /Applications, connect your MIDI interface, and open it."
