#!/usr/bin/env bash
# Copy RSVP reader to Mijia via USB file transfer (MTP) — no ADB required
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_NAME="rsvp-reader"

echo "Looking for Android device mounted via MTP..."

# macOS Android File Transfer / OpenMTP mount points
CANDIDATES=()
while IFS= read -r line; do
  CANDIDATES+=("$line")
done < <(ls -d /Volumes/* 2>/dev/null | rg -i "android|xiaomi|mijia|fyj|mtp|phone|internal" || true)

if [ ${#CANDIDATES[@]} -eq 0 ]; then
  echo ""
  echo "No Android volume found in /Volumes."
  echo ""
  echo "Steps:"
  echo "  1. Plug USB-C cable"
  echo "  2. On translator: USB notification → File transfer (MTP)"
  echo "  3. Install Android File Transfer or OpenMTP if Finder doesn't show the device"
  echo "  4. Re-run: $0"
  exit 1
fi

echo "Found:"
printf '  - %s\n' "${CANDIDATES[@]}"
VOL="${CANDIDATES[0]}"
echo ""
echo "Using: $VOL"

# Try common download paths on Android MTP
for SUB in "Download" "Internal shared storage/Download" "内部存储/Download" "内部存储设备/Download"; do
  TARGET="$VOL/$SUB/$DEST_NAME"
  PARENT="$VOL/$SUB"
  if [ -d "$PARENT" ]; then
    mkdir -p "$TARGET"
    cp "$DIR/index.html" "$TARGET/index.html"
    echo "Copied index.html → $TARGET/"
    echo ""
    echo "On device: Files → Download → rsvp-reader → index.html"
    echo "Or run ./serve.sh and open the URL in Chrome (easier)."
    exit 0
  fi
done

echo "Could not find Download folder on $VOL"
echo "Manually copy $DIR/index.html to the device Download folder."
exit 1