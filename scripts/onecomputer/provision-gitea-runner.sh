#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the Azure VM" >&2
  exit 1
fi

GITEA_URL="${GITEA_URL:-http://127.0.0.1:3001/}"
RUNNER_IMAGE="${RUNNER_IMAGE:-gitea/act_runner@sha256:46bd4abb4d961fcb559f6d9875b2ac41cafafe34f0e66b379d5e148665c7e5c2}"
RUNNER_DIR="/opt/onecomputer-act-runner"
RUNNER_USER="onecomputer-runner"

id "$RUNNER_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$RUNNER_DIR" "$RUNNER_USER"
usermod -aG docker "$RUNNER_USER"
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_DIR"

if ! command -v socat >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq socat
fi

if [[ ! -x "$RUNNER_DIR/act_runner" ]]; then
  docker pull "$RUNNER_IMAGE" >/dev/null
  container_id="$(docker create "$RUNNER_IMAGE")"
  docker cp "$container_id:/usr/local/bin/act_runner" "$RUNNER_DIR/act_runner"
  docker rm "$container_id" >/dev/null
  chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR/act_runner"
  chmod 0755 "$RUNNER_DIR/act_runner"
fi

if [[ ! -f "$RUNNER_DIR/config.yaml" ]]; then
  install -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0640 \
    /home/azureuser/work/onecomputer/deploy/runner/act-runner.yaml \
    "$RUNNER_DIR/config.yaml"
fi

if [[ ! -f "$RUNNER_DIR/.runner" ]]; then
  # Gitea 1.26 emits a structured log line before the token on stdout.
  # Pass only the final 40-character token to act_runner.
  token="$(docker exec --user git gitea gitea actions generate-runner-token | tail -n 1)"
  if [[ ! "$token" =~ ^[A-Za-z0-9_-]{40}$ ]]; then
    echo "Gitea returned an invalid runner registration token" >&2
    exit 1
  fi
  runuser -u "$RUNNER_USER" -- bash -c \
    "cd '$RUNNER_DIR' && exec '$RUNNER_DIR/act_runner' register \
      --config '$RUNNER_DIR/config.yaml' \
      --no-interactive \
      --instance '$GITEA_URL' \
      --token '$token' \
      --name 'onecomputer-azure-runner' \
      --labels 'onecomputer-ci:docker://node:22-bookworm,onecomputer-deploy:host'"
fi

install -o root -g root -m 0644 \
  /home/azureuser/work/onecomputer/deploy/systemd/onecomputer-act-runner.service \
  /etc/systemd/system/onecomputer-act-runner.service
install -o root -g root -m 0644 \
  /home/azureuser/work/onecomputer/deploy/systemd/onecomputer-gitea-ci-bridge.service \
  /etc/systemd/system/onecomputer-gitea-ci-bridge.service
install -o root -g root -m 0644 \
  /home/azureuser/work/onecomputer/deploy/sudoers/onecomputer-deploy \
  /etc/sudoers.d/onecomputer-deploy
visudo -cf /etc/sudoers.d/onecomputer-deploy >/dev/null
install -o root -g root -m 0755 \
  /home/azureuser/work/onecomputer/deploy/bin/onecomputer-deploy \
  /usr/local/sbin/onecomputer-deploy

systemctl daemon-reload
systemctl enable --now onecomputer-gitea-ci-bridge.service
systemctl enable --now onecomputer-act-runner.service
systemctl restart onecomputer-gitea-ci-bridge.service
systemctl restart onecomputer-act-runner.service
systemctl --no-pager --full status onecomputer-gitea-ci-bridge.service onecomputer-act-runner.service
