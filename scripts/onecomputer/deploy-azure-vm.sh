#!/usr/bin/env bash
set -euo pipefail

REF="${1:-codex/azure-e2e-openvtc}"
ROOT="/home/azureuser/work/onecomputer"

cd "$ROOT"
PREVIOUS_SHA="$(git rev-parse HEAD)"

write_deploy_provenance() {
  local sha="$1"
  sudo install -d -m 0755 /etc/systemd/system/onecomputer-web.service.d
  printf '[Service]\nEnvironment=ONECOMPUTER_BUILD_VERSION=%s\n' "$sha" | \
    sudo tee /etc/systemd/system/onecomputer-web.service.d/10-build-version.conf >/dev/null
}

rollback() {
  set +e
  echo "Deployment failed; restoring application checkout to $PREVIOUS_SHA" >&2
  git reset --hard "$PREVIOUS_SHA"
  write_deploy_provenance "$PREVIOUS_SHA"
  sudo systemctl daemon-reload
  sudo systemctl restart onecomputer-web.service onecomputer-gateway.service
}

trap rollback ERR

if [[ "$REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
  # CD passes the exact merge commit so the deployed source is unambiguous.
  git fetch origin "$REF"
  git checkout --detach "$REF"
else
  git fetch origin "$REF"
  git switch -C "$REF" --track "origin/$REF" 2>/dev/null || \
    git reset --hard "origin/$REF"
fi

if ! command -v socat >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq socat
fi

pnpm install --frozen-lockfile
pnpm db:generate
pnpm exec dotenv -e .env -- pnpm --filter @onecli/db prisma migrate deploy
pnpm exec dotenv -e .env -- pnpm --filter @onecli/web build
cargo build --release --manifest-path apps/gateway/Cargo.toml

sudo install -m 0644 deploy/systemd/onecomputer-web.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/onecomputer-gateway.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/onecomputer-litellm-bridge.service /etc/systemd/system/
write_deploy_provenance "$(git rev-parse HEAD)"
if [[ -f /etc/letsencrypt/live/onecomputer-openvtc.eastus2.cloudapp.azure.com/fullchain.pem ]]; then
  sudo install -m 0644 deploy/nginx/onecomputer-portal.conf /etc/nginx/sites-available/onecomputer-portal
  sudo ln -sfn /etc/nginx/sites-available/onecomputer-portal /etc/nginx/sites-enabled/onecomputer-portal
  set -a
  source .env
  set +a
  sudo bash scripts/onecomputer/render-kasm-nginx.sh \
    /etc/nginx/conf.d/onecomputer-kasm-desktops.conf \
    "${KASM_PORT_START:-16901}" "${KASM_PORT_END:-16910}"
  sudo nginx -t
  sudo systemctl reload nginx
fi
sudo systemctl daemon-reload

# Retire the pre-systemd development processes that previously owned the
# production ports. Restrict the patterns to this checkout and the known port.
pkill -u azureuser -f 'next dev --port 10254' 2>/dev/null || true
pkill -u azureuser -f '/home/azureuser/work/onecomputer/apps/gateway/target/release/onecli-gateway' 2>/dev/null || true

sudo systemctl enable --now onecomputer-web.service onecomputer-gateway.service onecomputer-litellm-bridge.service
sudo systemctl restart onecomputer-web.service onecomputer-gateway.service

curl --fail --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:10254/v1/health
curl --fail --retry 20 --retry-connrefused --retry-delay 1 http://127.0.0.1:10255/healthz
git rev-parse HEAD

trap - ERR
