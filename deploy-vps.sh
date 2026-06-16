#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@43.157.223.235}"
REMOTE_DIR="/var/www/rsvp-reader"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
PUBLIC_URL="${PUBLIC_URL:-https://zipang.id/rsvp/}"

echo "Deploying RSVP Reader → ${VPS_HOST}:${REMOTE_DIR}"
echo "Public URL: ${PUBLIC_URL}"
echo ""

ssh -o ConnectTimeout=15 "$VPS_HOST" "mkdir -p ${REMOTE_DIR}"

rsync -avz --delete \
  --exclude '.DS_Store' \
  --exclude 'serve.sh' \
  --exclude 'deploy-vps.sh' \
  --exclude 'adb-deploy.sh' \
  --exclude 'mtp-copy.sh' \
  --exclude 'sync-data/' \
  --exclude 'share-data/' \
  --exclude 'node_modules/' \
  --exclude 'memory/' \
  --exclude 'test/' \
  --exclude 'twa/' \
  --exclude 'scripts/' \
  --exclude '*.md' \
  --exclude 'bookmarklet.html' \
  "${LOCAL_DIR}/" \
  "${VPS_HOST}:${REMOTE_DIR}/"

ssh -o ConnectTimeout=15 "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
REMOTE_DIR="/var/www/rsvp-reader"
CONF="/etc/nginx/conf.d/rsvp-reader.conf"
ZIPANG="/etc/nginx/conf.d/zipang.conf"

# Standalone config (backup path if zipang location not used)
cat > "$CONF" <<'NGINX'
# RSVP Reader static files — also mounted at zipang.id/rsvp/
server {
    listen 80;
    server_name rsvp.zipang.id;
    return 301 https://zipang.id/rsvp/;
}
NGINX

# Inject /rsvp/ location into zipang.conf if missing
if ! grep -q 'location /rsvp/' "$ZIPANG"; then
  sed -i '/location \/ {/i\
    location /rsvp/ {\
        alias /var/www/rsvp-reader/;\
        index index.html;\
        add_header Cache-Control "no-cache";\
    }\
\

\
    location = /rsvp {\
        return 301 /rsvp/;\
    }\
' "$ZIPANG"
  echo "Added /rsvp/ location to zipang.conf"
else
  echo "/rsvp/ location already in zipang.conf"
fi

mkdir -p "$REMOTE_DIR/sync-data" "$REMOTE_DIR/summaries-data"
chown -R nginx:nginx "$REMOTE_DIR" 2>/dev/null || chown -R www-data:www-data "$REMOTE_DIR" 2>/dev/null || true
chmod -R a+r "$REMOTE_DIR"
chmod 775 "$REMOTE_DIR/sync-data" 2>/dev/null || true
chmod 755 "$REMOTE_DIR/summaries-data" 2>/dev/null || true

# Node sync API proxy
if ! grep -q 'location /rsvp/sync' "$ZIPANG"; then
  sed -i '/location = \/rsvp {/i\
    location /rsvp/sync {\
        proxy_pass http://127.0.0.1:9877/;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
    }\
' "$ZIPANG"
  echo "Added /rsvp/sync proxy to zipang.conf"
fi

if [ ! -f /etc/rsvp-reader.env ]; then
  echo "WARN: /etc/rsvp-reader.env missing — copy rsvp-sync.env.example and set RSVP_SYNC_JWT_SECRET"
fi

if ! grep -q 'location = /rsvp/sync-token' "$ZIPANG"; then
  sed -i '/location \/rsvp\/sync {/i\
    location = /rsvp/sync-token {\
        proxy_pass http://127.0.0.1:9877/token;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Forwarded-Proto $scheme;\
    }\
' "$ZIPANG"
  echo "Added /rsvp/sync-token proxy to zipang.conf"
fi

if command -v npm >/dev/null 2>&1; then
  cd "$REMOTE_DIR" && npm install --omit=dev
else
  echo "WARN: npm not found — run: cd $REMOTE_DIR && npm install --omit=dev"
fi

# Sync systemd service
cp "$REMOTE_DIR/rsvp-sync.service" /etc/systemd/system/rsvp-sync.service
systemctl daemon-reload
systemctl enable rsvp-sync
systemctl restart rsvp-sync
echo "rsvp-sync service: $(systemctl is-active rsvp-sync)"

if ! grep -q 'location \^~ /rsvp/summaries' "$ZIPANG"; then
  if grep -q 'location /rsvp/summaries' "$ZIPANG"; then
    sed -i 's|location /rsvp/summaries|location ^~ /rsvp/summaries|' "$ZIPANG"
    echo "Upgraded /rsvp/summaries proxy to ^~ priority"
  else
    sed -i '/location \/rsvp\/sync {/i\
    location ^~ /rsvp/summaries/ {\
        proxy_pass http://127.0.0.1:9879/;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
    }\
' "$ZIPANG"
    echo "Added /rsvp/summaries proxy to zipang.conf"
  fi
fi

cp "$REMOTE_DIR/rsvp-summaries.service" /etc/systemd/system/rsvp-summaries.service
systemctl enable rsvp-summaries
systemctl restart rsvp-summaries
echo "rsvp-summaries service: $(systemctl is-active rsvp-summaries)"

nginx -t
systemctl reload nginx
echo "nginx reloaded"
REMOTE

echo ""
echo "Done. Open on iPhone:"
echo "  ${PUBLIC_URL}"
echo ""
echo "Add to Home Screen: Safari → Share → Add to Home Screen"