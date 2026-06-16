# RSVP Reader — TWA build process

This directory contains everything you need to ship the RSVP Reader PWA as
a Trusted Web Activity (TWA) on Google Play.

## Files in this directory

| File                  | Purpose                                                                 |
|-----------------------|-------------------------------------------------------------------------|
| `twa-manifest.json`   | TWA config (package, host, icons, version, signing key).                |
| `assetlinks.json`     | Digital Asset Links — proves you own `zipang.id` to Android.            |
| `bubblewrap.config.cjs`| Bubblewrap CLI config; produces the Android project & APK.              |
| `store-listing.md`    | Short description, full description, short notes, what's new.           |
| `screenshots-spec.md` | Required screenshot dimensions and what each should show.              |
| `README.md`           | This file.                                                              |

## One-time setup

1. **Install the Bubblewrap CLI** (Node 18+ recommended):

   ```bash
   npm install -g @bubblewrap/cli
   # or, without a global install:
   npx @bubblewrap/cli --version
   ```

2. **Install JDK 17 and the Android SDK** (Bubblewrap's only system
   dependencies):

   ```bash
   brew install --cask temurin       # JDK 17
   brew install --cask android-commandlinetools
   sdkmanager "platform-tools" "build-tools;34.0.0" "platforms;android-34"
   ```

   Confirm `$ANDROID_HOME` (or `$ANDROID_SDK_ROOT`) is set and on `$PATH`.

## Build the TWA

Run these from this `twa/` directory.

### 1. Initialize the Android project from the live PWA manifest

```bash
npx @bubblewrap/cli init --manifest=https://zipang.id/rsvp/manifest.json
```

This writes `twa-manifest.json` (the same one already in this directory;
Bubblewrap may rewrite it — re-apply our `id.zipang.rsvp` and version
fields if it does).

### 2. Apply the package id and version

Open `twa-manifest.json` and confirm:

```json
{
  "packageId": "id.zipang.rsvp",
  "host": "zipang.id",
  "appVersion": "1.1.0",
  "appVersionCode": 110
}
```

`appVersionCode` must increase on every upload; Play Console will reject
duplicates.

### 3. Generate the upload keystore

```bash
keytool -genkey -v \
  -keystore android.keystore \
  -alias android \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

Answer the prompts. **Back up `android.keystore` and its passwords somewhere
safe** — losing it means losing the ability to push updates to existing
installs.

### 4. Plug the SHA-256 fingerprint into assetlinks.json

```bash
keytool -list -v -keystore android.keystore -alias android | \
  grep "SHA256:" | awk '{print $2}'
```

That prints a colon-separated SHA-256 fingerprint, e.g.:

```
3A:2B:...:F7
```

Strip the colons and paste the result (uppercase) into **two** places:

1. `twa/assetlinks.json` — the `sha256_cert_fingerprints` array.
2. `twa/twa-manifest.json` — the matching `REPLACE_WITH_SHA256_OF_UPLOAD_KEY`
   string inside `assetStatements`.

### 5. Serve assetlinks.json from zipang.id

The TWA will not launch in standalone mode until Android can fetch the
Digital Asset Links file from the PWA's domain. From your web server, make
sure the following URL returns the **exact** `assetlinks.json` from this
directory (no surrounding HTML, no redirects):

```
https://zipang.id/.well-known/assetlinks.json
```

For nginx:

```nginx
location = /.well-known/assetlinks.json {
  alias /var/www/zipang.id/.well-known/assetlinks.json;
  default_type application/json;
  add_header Cache-Control "public, max-age=300";
}
```

Test from any browser:

```bash
curl -sI https://zipang.id/.well-known/assetlinks.json
# HTTP/1.1 200 OK
# Content-Type: application/json
```

You can also verify Google's side at
<https://developers.google.com/digital-asset-links/tools/generator>.

### 6. Build the signed APK / AAB

```bash
npx @bubblewrap/cli build
```

Bubblewrap will run Gradle, sign the APK with `android.keystore`, and write
the artifacts into `app/build/outputs/`. The default output is an APK; for
Play Store we want an AAB:

```bash
npx @bubblewrap/cli build --appBundle
```

If Bubblewrap's build complains about a missing zipalign / apksigner, run
them manually on the unsigned APK:

```bash
$ANDROID_HOME/build-tools/34.0.0/zipalign -v -p 4 \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  app/build/outputs/apk/release/app-release-aligned.apk

$ANDROID_HOME/build-tools/34.0.0/apksigner sign \
  --ks android.keystore --ks-key-alias android \
  --out app/build/outputs/apk/release/app-release.apk \
  app/build/outputs/apk/release/app-release-aligned.apk
```

### 7. Upload to Play Console

1. Create the app at <https://play.google.com/console> (one-time $25 fee).
2. Fill in the four text fields from `store-listing.md`.
3. Drag-drop the screenshots from `screenshots-spec.md` and the feature
   graphic into the Graphics section.
4. Under **Release → Production → Create release**, upload
   `app-release-bundle.aab` (or `app-release.apk`).
5. Fill in the data-safety form — RSVP Reader collects nothing, so
   everything is "No, this data is not collected" / "No, this data is not
   shared".
6. Submit for review. First review usually takes 1–3 days; subsequent
   updates are hours.

## Updating an existing release

1. Bump `appVersion` and `appVersionCode` in `twa-manifest.json`.
2. `npx @bubblewrap/cli build --appBundle`
3. Upload the new AAB; the package name, signing key, and assetlinks.json
   stay the same.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Package not found" on the device | The assetlinks.json isn't being served, or the SHA-256 in it doesn't match the upload key. Check `curl https://zipang.id/.well-known/assetlinks.json`. |
| TWA opens in Chrome Custom Tabs instead of standalone | The user's Chrome version is old, or the Digital Asset Links check failed. Add `?utm_source=standalone` to the start URL. |
| Play Console rejects the AAB with "version code already used" | Increment `appVersionCode` in `twa-manifest.json` and rebuild. |
| Bubblewrap fails on Java version | You need JDK 17, not 11 or 21. `brew install --cask temurin`. |
