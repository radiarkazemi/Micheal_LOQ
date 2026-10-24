#!/usr/bin/env bash
# Install prebuilt release from /opt/micheal/deploy/release onto the VPS.
set -euo pipefail

APP_ROOT=/opt/micheal
RELEASE_DIR=${APP_ROOT}/deploy/release
ENV_FILE=/etc/micheal.env
LEGACY_ENV=/etc/vigil.env
SERVICE=micheal-cloud

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

cd "$RELEASE_DIR"
npm install --omit=dev

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$LEGACY_ENV" ]]; then
    cp "$LEGACY_ENV" "$ENV_FILE"
    # Normalize names while keeping values
    sed -i \
      -e 's/^VIGIL_HOST=/MICHEAL_HOST=/' \
      -e 's/^VIGIL_PORT=/MICHEAL_PORT=/' \
      -e 's/^VIGIL_TOKEN=/MICHEAL_TOKEN=/' \
      "$ENV_FILE"
  else
    TOKEN="$(openssl rand -hex 24)"
    cat >"$ENV_FILE" <<EOF
MICHEAL_HOST=0.0.0.0
MICHEAL_PORT=8787
MICHEAL_TOKEN=$TOKEN
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-4o-mini
EOF
  fi
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE"
fi

# Stop legacy service if present
systemctl stop vigil-cloud 2>/dev/null || true
systemctl disable vigil-cloud 2>/dev/null || true

cat >/etc/systemd/system/${SERVICE}.service <<EOF
[Unit]
Description=Micheal cloud trading brain
After=network.target

[Service]
Type=simple
WorkingDirectory=${RELEASE_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${RELEASE_DIR}/server/index.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${SERVICE}
systemctl restart ${SERVICE}

if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 8787/tcp || true
  ufw --force enable || true
fi

sleep 1
echo "Micheal cloud health:"
curl -sS "http://127.0.0.1:8787/health" || true
echo
echo "Token (keep private — paste into desktop VITE_MICHEAL_TOKEN):"
grep -E '^(MICHEAL_TOKEN|VIGIL_TOKEN)=' "$ENV_FILE" || true
systemctl --no-pager --full status ${SERVICE} | head -20
