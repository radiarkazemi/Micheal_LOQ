#!/usr/bin/env bash
# Build protocol + server + desktop HUD into deploy/release for the VPS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm install
pnpm --filter @micheal/protocol build
pnpm --filter @micheal/server build
VITE_MICHEAL_URL=http://91.107.171.162:8787 pnpm --filter @micheal/desktop build

RELEASE="$ROOT/deploy/release"
rm -rf "$RELEASE/server" "$RELEASE/protocol" "$RELEASE/hud"
mkdir -p "$RELEASE/server" "$RELEASE/protocol" "$RELEASE/hud" "$RELEASE/download"

cp -a "$ROOT/apps/server/dist/." "$RELEASE/server/"
cp -a "$ROOT/packages/protocol/dist/." "$RELEASE/protocol/"
cp -a "$ROOT/apps/desktop/dist/." "$RELEASE/hud/"

cat >"$RELEASE/protocol/package.json" <<'EOF'
{
  "name": "@micheal/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "./index.js",
  "types": "./index.d.ts",
  "exports": {
    ".": {
      "types": "./index.d.ts",
      "import": "./index.js"
    }
  }
}
EOF

cat >"$RELEASE/package.json" <<'EOF'
{
  "name": "micheal-cloud-release",
  "private": true,
  "type": "module",
  "dependencies": {
    "@micheal/protocol": "file:./protocol",
    "ws": "^8.18.3"
  }
}
EOF

cat >"$RELEASE/hud/install.html" <<'EOF'
<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>نصب میشل / Install Micheal</title>
  <style>
    body{font-family:Vazirmatn,system-ui,sans-serif;background:#03060a;color:#e8f0fa;margin:0;padding:32px;line-height:1.6}
    a{color:#4fd6c4} .card{max-width:640px;margin:0 auto;border:1px solid #2c4460;border-radius:16px;padding:24px;background:rgba(8,14,22,.9)}
    code{background:#111;padding:2px 6px;border-radius:6px}
    h1{color:#4fd6c4;letter-spacing:.08em}
  </style>
  <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600&display=swap" rel="stylesheet" />
</head>
<body>
  <div class="card">
    <h1>MICHEAL</h1>
    <p>مغز ابری آلمان همیشه زنده‌ست. از مرورگر یا اپ ویندوز وصل شو.</p>
    <ol>
      <li><a href="/">باز کردن HUD زنده در مرورگر</a> — بعد توکن را وارد کن</li>
      <li><a href="/download/Micheal-Windows.zip">دانلود اپ ویندوز (ZIP)</a></li>
      <li><a href="/download/Micheal-Setup.exe">نصب‌کننده ویندوز</a> (اگر آپلود شده باشد)</li>
    </ol>
    <p>EN: Live HUD always on the server. Windows tray app mirrors the same Germany brain.</p>
  </div>
</body>
</html>
EOF

echo "Release ready at $RELEASE"
ls -la "$RELEASE/server" | head
ls -la "$RELEASE/hud" | head
