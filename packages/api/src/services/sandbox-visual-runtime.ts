import type { ExecResult } from "./sandbox-providers/types";

export type VisualRuntimeStatus = {
  display: string;
  width: number;
  height: number;
  browserReady: boolean;
  capturedAt?: string;
};

export type SandboxScreenshot = VisualRuntimeStatus & {
  pngBase64: string;
};

type Exec = (id: string, command: string) => Promise<ExecResult>;

const assertDisplay = (display: string) => {
  if (!/^:\d+$/.test(display)) throw new Error("Invalid X11 display");
  return display;
};

export async function ensureVisualRuntime(
  id: string,
  exec: Exec,
  options: {
    display?: string;
    width?: number;
    height?: number;
    launchBrowser?: boolean;
  } = {},
): Promise<VisualRuntimeStatus> {
  const display = assertDisplay(options.display ?? ":99");
  const width = options.width ?? 1440;
  const height = options.height ?? 900;
  const launchBrowser = options.launchBrowser ?? true;
  const command = `set -eu
command -v ffmpeg >/dev/null
mkdir -p /tmp/onecomputer-visual
if ! DISPLAY=${display} xdpyinfo >/dev/null 2>&1; then
  command -v Xvfb >/dev/null
  nohup Xvfb ${display} -screen 0 ${width}x${height}x24 -nolisten tcp >/tmp/onecomputer-visual/xvfb.log 2>&1 </dev/null &
  echo $! >/tmp/onecomputer-visual/xvfb.pid
  for i in $(seq 1 50); do DISPLAY=${display} xdpyinfo >/dev/null 2>&1 && break; sleep .1; done
fi
if command -v openbox >/dev/null && ! pgrep -f "openbox.*${display}" >/dev/null 2>&1; then
  nohup env DISPLAY=${display} openbox >/tmp/onecomputer-visual/openbox.log 2>&1 </dev/null &
fi
if ${launchBrowser ? "true" : "false"} && ! curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  browser=$(command -v chromium || command -v chromium-browser || command -v google-chrome || true)
  if test -n "$browser"; then
    nohup env DISPLAY=${display} "$browser" --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir=/tmp/onecomputer-visual/chrome about:blank >/tmp/onecomputer-visual/chromium.log 2>&1 </dev/null &
    for i in $(seq 1 100); do curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break; sleep .1; done
  fi
fi
geometry=$(DISPLAY=${display} xdpyinfo | awk '/dimensions:/{value=$2} END{print value}')
test -n "$geometry"
curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1 && readiness=browser-ready || readiness=display-ready
printf 'onecomputer-visual %s %s\n' "$geometry" "$readiness"`;
  const result = await exec(id, command);
  if (result.exitCode !== 0)
    throw new Error(
      `Visual runtime bootstrap failed: ${result.output.slice(-1000)}`,
    );
  const observed = result.output.match(
    /onecomputer-visual\s+(\d+)x(\d+)\s+(browser-ready|display-ready)/,
  );
  if (!observed) throw new Error("Visual runtime did not report X11 geometry");
  return {
    display,
    width: Number(observed[1]),
    height: Number(observed[2]),
    browserReady: observed[3] === "browser-ready",
  };
}

export async function captureX11Screenshot(
  id: string,
  exec: Exec,
  options: { display?: string; width?: number; height?: number } = {},
): Promise<SandboxScreenshot> {
  const display = assertDisplay(options.display ?? ":99");
  const result = await exec(
    id,
    `set -euo pipefail; geometry=$(DISPLAY=${display} xdpyinfo | awk '/dimensions:/{value=$2} END{print value}'); test -n "$geometry"; printf '%s\n' "$geometry"; DISPLAY=${display} ffmpeg -hide_banner -loglevel error -f x11grab -video_size "$geometry" -i ${display} -frames:v 1 -f image2pipe -vcodec png - | base64 -w0`,
  );
  if (result.exitCode !== 0 || !result.output.trim())
    throw new Error(`X11 capture failed: ${result.output.slice(-1000)}`);
  const newline = result.output.indexOf("\n");
  if (newline < 0) throw new Error("X11 capture did not report geometry");
  const geometry = result.output.slice(0, newline).match(/^(\d+)x(\d+)$/);
  if (!geometry) throw new Error("X11 capture reported invalid geometry");
  const pngBase64 = result.output.slice(newline + 1).trim();
  const signature = Buffer.from(pngBase64.slice(0, 12), "base64")
    .subarray(0, 8)
    .toString("hex");
  if (signature !== "89504e470d0a1a0a")
    throw new Error("X11 capture did not return a PNG image");
  return {
    display,
    width: Number(geometry[1]),
    height: Number(geometry[2]),
    browserReady: true,
    capturedAt: new Date().toISOString(),
    pngBase64,
  };
}
