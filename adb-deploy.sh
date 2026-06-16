#!/usr/bin/env bash
# Build a tiny debug APK wrapper OR sideload via adb if device is connected
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Checking ADB ==="
if ! command -v adb >/dev/null; then
  echo "adb not found. Install: brew install android-platform-tools"
  exit 1
fi

adb start-server
DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')

if [ -z "$DEVICES" ]; then
  echo ""
  echo "No device connected. To enable ADB on Mijia AI Translator:"
  echo "  1. Plug in USB-C cable to Mac"
  echo "  2. On device: Settings → About → tap 'Build number' 7 times"
  echo "  3. Settings → Developer options → enable 'USB debugging'"
  echo "  4. Accept the RSA fingerprint prompt on device screen"
  echo "  5. Run: adb devices"
  echo ""
  echo "Alternative (no ADB): run ./serve.sh and open http://YOUR_MAC_IP:8765 in Chrome"
  exit 1
fi

echo "Connected: $DEVICES"
echo ""
echo "=== Device info ==="
adb shell getprop ro.product.model 2>/dev/null || true
adb shell getprop ro.build.version.release 2>/dev/null || true
echo ""

# Push HTML to device and open in browser
REMOTE_DIR="/sdcard/Download/rsvp-reader"
echo "=== Pushing files to $REMOTE_DIR ==="
adb shell mkdir -p "$REMOTE_DIR"
adb push "$DIR/index.html" "$REMOTE_DIR/index.html"

echo ""
echo "=== Opening in browser ==="
# Try common Android intents
adb shell am start -a android.intent.action.VIEW \
  -d "file://$REMOTE_DIR/index.html" \
  -t "text/html" 2>/dev/null || \
adb shell am start -a android.intent.action.VIEW \
  -d "content://com.android.externalstorage.documents/document/primary:Download/rsvp-reader/index.html" 2>/dev/null || \
echo "Could not auto-open. On device: Files → Download → rsvp-reader → index.html"

echo ""
echo "Done. Or use LAN mode: ./serve.sh"