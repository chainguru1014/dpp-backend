#!/usr/bin/env bash
# Installs CompreFace (self-hosted, open-source face recognition) next to the
# DPP backend and creates the recognition service the backend's face sign-in
# uses. Run once on the hosting server as a sudo-capable user:
#
#   bash deploy/compreface/install.sh
#
# What it does:
#   - installs Docker + Compose (Ubuntu packages)
#   - downloads the official CompreFace v1.2.0 compose files to ~/compreface
#   - sets a random Postgres password, stops storing face photos (only the
#     face embeddings are kept), and binds the UI/API to 127.0.0.1:8000 so
#     CompreFace is NOT reachable from the internet — only this server's
#     backend talks to it
#   - starts it, creates an admin login + "DPP" app + "face-login"
#     recognition service, and prints the lines to add to the backend .env
#
# Safe to re-run: it keeps an existing ~/compreface/.env (and its password).
set -euo pipefail

CF_VERSION=1.2.0
CF_DIR="$HOME/compreface"
CF_URL="http://127.0.0.1:8000"
ADMIN_EMAIL="${CF_ADMIN_EMAIL:-compreface-admin@yometel.local}"

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 unzip curl
  sudo systemctl enable --now docker
fi
sudo docker compose version >/dev/null

echo "==> Fetching CompreFace $CF_VERSION into $CF_DIR"
mkdir -p "$CF_DIR"
cd "$CF_DIR"
if [ ! -f docker-compose.yml ]; then
  curl -fsSL -o cf.zip "https://github.com/exadel-inc/CompreFace/releases/download/v${CF_VERSION}/CompreFace_${CF_VERSION}.zip"
  unzip -o -q cf.zip && rm cf.zip
  PG_PASS="$(openssl rand -hex 24)"
  sed -i \
    -e "s/^postgres_password=.*/postgres_password=${PG_PASS}/" \
    -e "s/^save_images_to_db=.*/save_images_to_db=false/" \
    -e "s/^compreface_api_java_options=.*/compreface_api_java_options=-Xmx2g/" \
    .env
  # UI/API on localhost only.
  sed -i 's/- "8000:80"/- "127.0.0.1:8000:80"/' docker-compose.yml
fi
grep -q '127.0.0.1:8000:80' docker-compose.yml || { echo "Port binding patch failed — refusing to expose CompreFace publicly"; exit 1; }

echo "==> Starting containers (first start pulls ~3 GB of images)"
sudo docker compose up -d

echo "==> Waiting for CompreFace to answer on $CF_URL"
for i in $(seq 1 120); do
  if curl -fs -o /dev/null "$CF_URL/"; then break; fi
  sleep 5
done
# admin service needs a little longer than the UI
sleep 20

ADMIN_PASS_FILE="$CF_DIR/.admin-password"
if [ ! -f "$ADMIN_PASS_FILE" ]; then
  openssl rand -hex 16 > "$ADMIN_PASS_FILE"
  chmod 600 "$ADMIN_PASS_FILE"
fi
ADMIN_PASS="$(cat "$ADMIN_PASS_FILE")"

echo "==> Creating admin user, app and recognition service"
curl -fs -o /dev/null -X POST "$CF_URL/admin/user/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"firstName\":\"Yometel\",\"lastName\":\"Admin\",\"isAllowStatistics\":false}" \
  || echo "   (admin user probably exists already)"

TOKEN="$(curl -fs -X POST "$CF_URL/admin/oauth/token" \
  -H 'Authorization: Basic Q29tbW9uQ2xpZW50SWQ6cGFzc3dvcmQ=' \
  --data-urlencode "username=$ADMIN_EMAIL" \
  --data-urlencode "password=$ADMIN_PASS" \
  --data-urlencode 'grant_type=password' | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
[ -n "$TOKEN" ] || { echo "Could not log in to the CompreFace admin API. Open the UI through an SSH tunnel (ssh -L 8000:127.0.0.1:8000 ...) and create a Recognition service by hand."; exit 1; }

APP_ID="$(curl -fs "$CF_URL/admin/apps" -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"id":"\([^"]*\)","name":"DPP".*/\1/p')"
if [ -z "$APP_ID" ]; then
  APP_ID="$(curl -fs -X POST "$CF_URL/admin/app" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"DPP"}' | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
fi
[ -n "$APP_ID" ] || { echo "Could not create the CompreFace app."; exit 1; }

API_KEY="$(curl -fs "$CF_URL/admin/app/$APP_ID/models" -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"apiKey":"\([^"]*\)","name":"face-login".*/\1/p')"
if [ -z "$API_KEY" ]; then
  API_KEY="$(curl -fs -X POST "$CF_URL/admin/app/$APP_ID/model" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"face-login","type":"RECOGNITION"}' | sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p')"
fi
[ -n "$API_KEY" ] || { echo "Could not create the recognition service."; exit 1; }

cat <<EOF

==> Done. CompreFace is running on $CF_URL (this server only).
    Admin UI login (via SSH tunnel): $ADMIN_EMAIL / password in $ADMIN_PASS_FILE

Add these lines to the backend .env, then restart the backend (pm2 restart dpp-backend):

COMPREFACE_URL=$CF_URL
COMPREFACE_API_KEY=$API_KEY
EOF
