#!/usr/bin/env bash
set -euo pipefail

# Render one TLS nginx listener per managed Kasm desktop port. Kasm containers
# deliberately bind their noVNC endpoint to loopback; the public listener is
# terminated here with the portal's Let's Encrypt certificate.
OUTPUT="${1:?output path is required}"
START_PORT="${2:-16901}"
END_PORT="${3:-16910}"
LISTEN_IP="${4:-10.0.0.4}"
HOSTNAME="${5:-onecomputer-openvtc.eastus2.cloudapp.azure.com}"
CERT_DIR="/etc/letsencrypt/live/${HOSTNAME}"

if (( START_PORT > END_PORT )); then
  echo "Kasm port range is invalid: ${START_PORT}-${END_PORT}" >&2
  exit 1
fi

{
  for ((port = START_PORT; port <= END_PORT; port += 1)); do
    cat <<EOF
server {
    listen ${LISTEN_IP}:${port} ssl;
    server_name ${HOSTNAME};
    ssl_certificate ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {
        proxy_pass https://127.0.0.1:${port};
        proxy_ssl_verify off;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

EOF
  done
} >"${OUTPUT}"
