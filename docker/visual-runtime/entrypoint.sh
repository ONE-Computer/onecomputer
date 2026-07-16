#!/bin/sh
set -eu

width="${ONECOMPUTER_DISPLAY_WIDTH:-1440}"
height="${ONECOMPUTER_DISPLAY_HEIGHT:-900}"
display="${DISPLAY:-:99}"
mkdir -p /tmp/onecomputer-visual

Xvfb "$display" -screen 0 "${width}x${height}x24" -nolisten tcp > /tmp/onecomputer-visual/xvfb.log 2>&1 &
for _ in $(seq 1 50); do
  DISPLAY="$display" xdpyinfo >/dev/null 2>&1 && break
  sleep .1
done
DISPLAY="$display" openbox > /tmp/onecomputer-visual/openbox.log 2>&1 &
DISPLAY="$display" chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/onecomputer-visual/chrome \
  about:blank > /tmp/onecomputer-visual/chromium.log 2>&1 &

exec "$@"
