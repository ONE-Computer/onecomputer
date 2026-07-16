FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium curl ffmpeg fonts-dejavu-core fonts-liberation \
    openbox tini x11-utils xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 1000 --shell /bin/bash agent

COPY entrypoint.sh /usr/local/bin/onecomputer-visual-entrypoint
RUN chmod 0755 /usr/local/bin/onecomputer-visual-entrypoint \
  && mkdir -p /workspace /tmp/onecomputer-visual \
  && chown -R agent:agent /workspace /tmp/onecomputer-visual

LABEL org.opencontainers.image.title="ONEComputer headless visual runtime" \
      org.opencontainers.image.description="Xvfb, Openbox, Chromium and ffmpeg capture for a microVM-contained agent workspace" \
      onecomputer.runtime.visual="x11-headless-v1"

ENV DISPLAY=:99 \
    ONECOMPUTER_DISPLAY_WIDTH=1440 \
    ONECOMPUTER_DISPLAY_HEIGHT=900
WORKDIR /workspace
USER agent
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/onecomputer-visual-entrypoint"]
CMD ["sleep", "infinity"]
