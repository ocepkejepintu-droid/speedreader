#!/usr/bin/env bash
# Serve RSVP reader on your LAN so phone/Mijia can open it
PORT="${1:-8765}"
DIR="$(cd "$(dirname "$0")" && pwd)"
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

echo "RSVP Reader"
echo "  Local:   http://127.0.0.1:${PORT}"
echo "  Network: http://${IP:-YOUR_MAC_IP}:${PORT}"
echo ""
echo "On Android/Mijia: open the Network URL in Chrome"
echo "Press Ctrl+C to stop"
cd "$DIR" && python3 -m http.server "$PORT"