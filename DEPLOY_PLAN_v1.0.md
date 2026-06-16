# RSVP Reader v1.0 — Deployment Plan

Target: VPS at `root@43.157.223.235`, served from `/var/www/rsvp-reader/`,
proxied through `zipang.conf` (location `/rsvp/`, `/rsvp/sync`, `/rsvp/sync-token`).
Sync server: `systemd rsvp-sync.service` listening on `127.0.0.1:9877`.
Share server: NEW, `systemd rsvp-share.service` on `127.0.0.1:9878`.

## Pre-flight findings

Live site is 3 versions behind. Live state observed (2026-06-14):

- `index.html` on disk is **37055 bytes** (working tree, dated 2026-06-14
  07:02). Live at `/rsvp/` is **30726 bytes**, last modified 2026-06-12
  11:57. The live file does NOT contain `statsPanel`, `share_target`, or
  `bookmarklet` references.
- `manifest.json` is also stale: live size 188 bytes (2026-06-10). Working
  tree is 805 bytes (2026-06-14 06:38) and adds the `share_target` block.
- `library.js` and `reader-app.js` on disk are newer (Jun 14) than the live
  copies (Jun 12) — they are missing the v1.0.1 library sync and the
  `?article=` handoff for share.
- The `icons/` directory does not exist remotely. All `/rsvp/icons/*.png`
  return 404. The 1x1 placeholder was never replaced.
- `share.mjs`, `share-store.mjs`, `article-extract.mjs`, `share-handler.html`,
  `bookmarklet.html` are missing remotely. `/rsvp/share` and
  `/rsvp/share-target` both return 404.
- `/rsvp/sync-token` returns 401 as expected (no auth cookie). `/rsvp/sync`
  returns 401 for the same reason. Sync server is running (PID 787100,
  active, enabled), but `sync-server.mjs` on the server is the v0.x build
  (3915 bytes, 2026-06-13 13:43). The v1.0 build is 5251 bytes and adds
  `/health` and async writes.
- `/.well-known/assetlinks.json` returns 404. The TWA README at
  `twa/README.md:101-128` requires this URL to return 200.
- `auth.js`, `auth-config.js`, `epub.js`, `jszip.mjs`, `timing.js`,
  `wordlist.txt` on disk are not byte-identical to the live copies (most
  are unchanged, but `auth.js` is the newer Jun 13 build). The plan rsync's
  the whole updated set.

## Files to ship (rsync to `/var/www/rsvp-reader/` on the VPS)

Source directory on this Mac: `/Users/yoseph/rsvp-reader/`
Remote directory:             `/var/www/rsvp-reader/` (owned by `nginx:nginx`)

PWA static:

- `index.html`
- `reader-app.js`
- `library.js`
- `auth.js`
- `auth-config.js`
- `epub.js`
- `timing.js`
- `jszip.mjs`
- `wordlist.txt`
- `manifest.json`
- `icons/` (entire directory — 5 PNGs: 16, 32, 180, 192, 512)
- `bookmarklet.html` (NEW)
- `share-handler.html` (NEW)

Backend (mjs files Node loads from the same dir):

- `sync-server.mjs`
- `rsvp-sync-token.mjs`
- `share.mjs` (NEW)
- `share-store.mjs` (NEW)
- `article-extract.mjs` (NEW — imported by share.mjs)

Config and service files:

- `package.json`
- `package-lock.json`
- `rsvp-sync.service`
- `rsvp-sync.env.example`
- `rsvp-share.service` (NEW — written to working tree by this plan)
- `rsvp-share.env.example` (NEW — written to working tree by this plan)

Excluded (matches `deploy-vps.sh`):

- `serve.sh`, `deploy-vps.sh`, `adb-deploy.sh`, `mtp-copy.sh`
- `sync-data/`, `share-data/`, `node_modules/`, `memory/`
- `.DS_Store`, `.gstack/`

## The exact commands, in order

These must be run by the founder on the Mac. The deploy target is the
remote VPS at `43.157.223.235` — the local Mac is the working tree, not
the served directory, so we go through `ssh` + `rsync` exactly like
`deploy-vps.sh` does. The script below is the canonical, runnable form
for the v1.0 release.

```bash
set -euo pipefail

# ---------- 0. Pre-flight (run on the Mac) ----------
LOCAL_DIR="/Users/yoseph/rsvp-reader"
VPS_HOST="root@43.157.223.235"
REMOTE_DIR="/var/www/rsvp-reader"

cd "$LOCAL_DIR"

# ---------- 1. Sync the working tree to the VPS ----------
ssh -o ConnectTimeout=15 "$VPS_HOST" "mkdir -p ${REMOTE_DIR} ${REMOTE_DIR}/sync-data ${REMOTE_DIR}/share-data"

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
  --exclude '.gstack/' \
  --exclude 'test/' \
  --exclude 'twa/' \
  --exclude '*.md' \
  --exclude 'package-lock.json.bak*' \
  "$LOCAL_DIR/index.html" \
  "$LOCAL_DIR/epub.js" \
  "$LOCAL_DIR/library.js" \
  "$LOCAL_DIR/reader-app.js" \
  "$LOCAL_DIR/auth.js" \
  "$LOCAL_DIR/auth-config.js" \
  "$LOCAL_DIR/rsvp-sync-token.mjs" \
  "$LOCAL_DIR/timing.js" \
  "$LOCAL_DIR/wordlist.txt" \
  "$LOCAL_DIR/package.json" \
  "$LOCAL_DIR/package-lock.json" \
  "$LOCAL_DIR/sync-server.mjs" \
  "$LOCAL_DIR/share.mjs" \
  "$LOCAL_DIR/share-store.mjs" \
  "$LOCAL_DIR/article-extract.mjs" \
  "$LOCAL_DIR/rsvp-sync.service" \
  "$LOCAL_DIR/rsvp-sync.env.example" \
  "$LOCAL_DIR/rsvp-share.service" \
  "$LOCAL_DIR/rsvp-share.env.example" \
  "$LOCAL_DIR/jszip.mjs" \
  "$LOCAL_DIR/manifest.json" \
  "$LOCAL_DIR/icons" \
  "$LOCAL_DIR/bookmarklet.html" \
  "$LOCAL_DIR/share-handler.html" \
  "$VPS_HOST:$REMOTE_DIR/"

# ---------- 2. Install / refresh Node deps ----------
ssh -o ConnectTimeout=15 "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /var/www/rsvp-reader
if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev
else
  echo "FATAL: npm not found on the VPS" >&2
  exit 1
fi
REMOTE

# ---------- 3. Install the new share systemd unit ----------
ssh -o ConnectTimeout=15 "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
# Write the env file if it does not exist yet. The share server does not
# need a secret, only the port and data dir.
if [ ! -f /etc/rsvp-share.env ]; then
  cp /var/www/rsvp-reader/rsvp-share.env.example /etc/rsvp-share.env
  chmod 640 /etc/rsvp-share.env || true
  echo "Wrote /etc/rsvp-share.env"
else
  echo "/etc/rsvp-share.env already exists — leaving alone"
fi

# Install and start the share service.
cp /var/www/rsvp-reader/rsvp-share.service /etc/systemd/system/rsvp-share.service
systemctl daemon-reload
systemctl enable rsvp-share
systemctl restart rsvp-share
echo "rsvp-share service: $(systemctl is-active rsvp-share)"

# Refresh the sync service (same unit, new code).
systemctl restart rsvp-sync
echo "rsvp-sync service: $(systemctl is-active rsvp-sync)"
REMOTE

# ---------- 4. Patch nginx: add /rsvp/share, /rsvp/share-target, /rsvp/share/article/, and /.well-known/assetlinks.json ----------
ssh -o ConnectTimeout=15 "$VPS_HOST" bash -s <<'REMOTE'
set -euo pipefail
ZIPANG="/etc/nginx/conf.d/zipang.conf"
REMOTE_DIR="/var/www/rsvp-reader"
WELL_KNOWN_DIR="/var/www/zipang.id/.well-known"

# PWA static files are served at /rsvp/ — the existing location block
# already aliases REMOTE_DIR. We only need to add reverse-proxy rules for
# the two share endpoints and the assetlinks file.

if ! grep -q 'location = /rsvp/share' "$ZIPANG"; then
  # Insert the share block right after the /rsvp/sync-token block. nginx
  # is happy with arbitrary ordering for distinct location = blocks.
  sed -i '/location = \/rsvp\/sync-token {/,/^    }/a\
\
    location = /rsvp/share {\
        proxy_pass http://127.0.0.1:9878/share;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        client_max_body_size 1m;\
    }\
\
    location = /rsvp/share-target {\
        proxy_pass http://127.0.0.1:9878/share-target;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
        client_max_body_size 1m;\
    }\
\
    location ~ ^/rsvp/share/article/([a-f0-9]{6,128})$ {\
        proxy_pass http://127.0.0.1:9878/share/article/$1;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\
        proxy_set_header X-Forwarded-Proto $scheme;\
    }' "$ZIPANG"
  echo "Added /rsvp/share, /rsvp/share-target, /rsvp/share/article/ to zipang.conf"
else
  echo "Share proxy blocks already present in zipang.conf"
fi

# TWA Digital Asset Links — required for the standalone TWA launch.
mkdir -p "$WELL_KNOWN_DIR"
cp "$REMOTE_DIR/../twa/assetlinks.json" "$WELL_KNOWN_DIR/assetlinks.json" 2>/dev/null || \
  echo "WARN: $REMOTE_DIR/../twa/assetlinks.json not on disk — copy it from the local twa/ directory"
chmod 644 "$WELL_KNOWN_DIR/assetlinks.json" 2>/dev/null || true

if ! grep -q 'location = /.well-known/assetlinks.json' "$ZIPANG"; then
  sed -i '/location = \/rsvp {/i\
    location = /.well-known/assetlinks.json {\
        alias /var/www/zipang.id/.well-known/assetlinks.json;\
        default_type application/json;\
        add_header Cache-Control "public, max-age=300";\
    }\
' "$ZIPANG"
  echo "Added /.well-known/assetlinks.json to zipang.conf"
else
  echo "assetlinks.json location already present"
fi

nginx -t
systemctl reload nginx
echo "nginx reloaded"
REMOTE

# ---------- 5. Verify ----------
echo ""
echo "=== Verification ==="
echo "GET /rsvp/"
curl -sS -o /dev/null -w "  HTTP %{http_code}  %{size_download}B  %{content_type}\n" https://zipang.id/rsvp/

echo "GET /rsvp/manifest.json"
curl -sS -o /dev/null -w "  HTTP %{http_code}  %{size_download}B  %{content_type}\n" https://zipang.id/rsvp/manifest.json

echo "GET /rsvp/icons/icon-192.png"
curl -sS -o /dev/null -w "  HTTP %{http_code}  %{size_download}B  %{content_type}\n" https://zipang.id/rsvp/icons/icon-192.png

echo "GET /rsvp/?stats=1 (looks for statsPanel in the HTML)"
curl -sS https://zipang.id/rsvp/?stats=1 | grep -q statsPanel && echo "  statsPanel: FOUND" || echo "  statsPanel: MISSING"

echo "POST /rsvp/share (json {text,url,title})"
curl -sS -X POST https://zipang.id/rsvp/share \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","title":"deploy-check","text":"hello world this is a test","shareSource":"deploy-check"}' \
  -w "\n  HTTP %{http_code}  %{size_download}B  %{content_type}\n"

echo "GET /rsvp/sync-token (expected 401 without cookie)"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" https://zipang.id/rsvp/sync-token

echo "GET /rsvp/sync (expected 401 without bearer)"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" https://zipang.id/rsvp/sync

echo "GET /rsvp/share-target (expected 302 -> /rsvp/)"
curl -sS -o /dev/null -w "  HTTP %{http_code}\n" https://zipang.id/rsvp/share-target

echo "GET /.well-known/assetlinks.json"
curl -sS -o /dev/null -w "  HTTP %{http_code}  %{size_download}B  %{content_type}\n" https://zipang.id/.well-known/assetlinks.json

echo ""
echo "Done. Open https://zipang.id/rsvp/ on iPhone, Add to Home Screen."
```

## Why each step is here

1. **rsync `--delete`** is needed because the live tree is missing
   `icons/`, `bookmarklet.html`, `share-handler.html`, `share.mjs`, and
   `share-store.mjs`. Without `--delete`, the stale files persist. The
   exclude list is wider than the v0.x script because we now ship a
   `share-data/` directory that we must not clobber.
2. **`npm install --omit=dev`** ensures the new `next-auth` + `jszip`
   versions referenced by `sync-server.mjs` are present. The remote
   `package.json` is older (124 bytes) than the working tree (344 bytes).
3. **Restart `rsvp-sync`** picks up the new sync-server.mjs (rate limit
   + /health + async writes).
4. **Start `rsvp-share`** for the first time — the unit is in the
   working tree but no unit file exists on the VPS yet.
5. **nginx patch** adds three new location blocks (`/rsvp/share`,
   `/rsvp/share-target`, `/rsvp/share/article/...`) and the TWA
   `/.well-known/assetlinks.json` block. The existing `/rsvp/`, `/rsvp/sync`,
   and `/rsvp/sync-token` blocks are untouched.
6. **Verification** matches the spec in the task.

## TWA assetlinks.json

The TWA needs `https://zipang.id/.well-known/assetlinks.json` to return
the JSON in `twa/assetlinks.json` (working tree). The plan copies that
file into `/var/www/zipang.id/.well-known/assetlinks.json` on the VPS
and serves it via a new nginx location block.

**SHA-256 fingerprint is still `REPLACE_WITH_SHA256_OF_UPLOAD_KEY`** in
the working tree. The founder must update it before submitting the TWA
to Play Console (see `twa/README.md` step 4). The Android install path
will work with the placeholder only after Bubblewrap rewrites the file
during `bubblewrap build`.

## Pre-flight issue (heads up)

- The new `rsvp-share.service` runs as user `nginx`. The existing
  `rsvp-sync.service` runs as root (no `User=`/`Group=` set, so it
  defaults to root). Both write to `/var/www/rsvp-reader/`. Make sure
  `/var/www/rsvp-reader/share-data/` is owned by `nginx:nginx` and is
  writable. The plan does `chown -R nginx:nginx` in step 4 of the
  existing `deploy-vps.sh`; we add `chown nginx:nginx .../share-data`
  to the systemd unit's `ExecStartPre` if needed. (Implementation: add
  `ExecStartPre=/bin/chown -R nginx:nginx /var/www/rsvp-reader/share-data`
  to the unit if first-run fails. Not in the snippet above because the
  plan already creates the dir before starting the service.)
- The 25 MB `client_max_body_size` set at the server level in
  `zipang.conf` is large enough for EPUB uploads through the PWA. We
  override the share endpoints with `client_max_body_size 1m` because
  the share server has its own 512 KB / 256 KB body caps in code.
- `share.mjs` calls `fetchAndExtract(url)` server-side when the share
  payload has no `text`. The VPS must be able to make outbound HTTPS
  requests. Existing sync-server can already hit the network for
  NextAuth, so this should be fine — but if the VPS is firewalled the
  `POST /share` call with only a `url` will return 502.
- `rssvp-share.env.example` sets `RSVP_SHARE_DIR` to
  `/var/www/rsvp-reader/share-data`. The systemd unit's `ReadWritePaths=`
  restricts writes to that path under `ProtectSystem=full`. If the
  service fails with EACCES on first POST, the dir is probably owned
  by root — `chown -R nginx:nginx /var/www/rsvp-reader/share-data`.
