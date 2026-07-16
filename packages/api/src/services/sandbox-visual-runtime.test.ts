import { describe, expect, it, vi } from "vitest";
import {
  captureX11Screenshot,
  ensureVisualRuntime,
} from "./sandbox-visual-runtime";
import type { ExecResult } from "./sandbox-providers/types";

type Exec = (id: string, command: string) => Promise<ExecResult>;

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=";

describe("sandbox visual runtime", () => {
  it("starts Xvfb and loopback-only Chromium without a VNC dependency", async () => {
    const exec = vi.fn<Exec>().mockResolvedValue({
      exitCode: 0,
      output: "onecomputer-visual 1024x768 browser-ready",
    });
    const status = await ensureVisualRuntime("sandbox-1", exec, {
      display: ":99",
      width: 1280,
      height: 720,
    });

    expect(status).toEqual({
      display: ":99",
      width: 1024,
      height: 768,
      browserReady: true,
    });
    const command = exec.mock.calls[0]?.[1] ?? "";
    expect(command).toContain("Xvfb :99 -screen 0 1280x720x24");
    expect(command.indexOf("xdpyinfo")).toBeLessThan(
      command.indexOf("command -v Xvfb"),
    );
    expect(command).toContain("--remote-debugging-address=127.0.0.1");
    expect(command).not.toContain("vnc");
  });

  it("validates PNG frames captured through ffmpeg x11grab", async () => {
    const exec = vi
      .fn<Exec>()
      .mockResolvedValue({ exitCode: 0, output: `800x600\n${ONE_PIXEL_PNG}` });
    const frame = await captureX11Screenshot("sandbox-1", exec, {
      display: ":7",
      width: 800,
      height: 600,
    });

    expect(frame.pngBase64).toBe(ONE_PIXEL_PNG);
    expect(frame).toMatchObject({ display: ":7", width: 800, height: 600 });
    expect(exec.mock.calls[0]?.[1]).toContain("-f x11grab");
    expect(exec.mock.calls[0]?.[1]).toContain("xdpyinfo");
    expect(exec.mock.calls[0]?.[1]).not.toContain("print $2; exit");
  });

  it("rejects malformed frame data", async () => {
    const exec = vi.fn<Exec>().mockResolvedValue({
      exitCode: 0,
      output: `800x600\n${Buffer.from("not png").toString("base64")}`,
    });
    await expect(captureX11Screenshot("sandbox-1", exec)).rejects.toThrow(
      "did not return a PNG",
    );
  });
});
