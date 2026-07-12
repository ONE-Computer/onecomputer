"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { sandboxesApi } from "@/lib/api/sandboxes";

// xterm CSS import — must be done at module level so Next.js bundles it.
import "@xterm/xterm/css/xterm.css";

interface SandboxTerminalProps {
  sandboxId: string;
}

const SHORT_ID_LEN = 8;

export const SandboxTerminal = ({ sandboxId }: SandboxTerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Store terminal + addon as refs so they survive re-renders without triggering them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  // lineBuffer accumulates the current typed line so we can handle backspace etc.
  const lineBufferRef = useRef("");
  const busyRef = useRef(false);

  const shortId = sandboxId.slice(0, SHORT_ID_LEN);
  const prompt = `daytona@${shortId}:~$ `;

  // Keep busyRef in sync with React state so the keydown handler (closure) sees it.
  const setBusySync = useCallback((val: boolean) => {
    busyRef.current = val;
    setBusy(val);
  }, []);

  const writePrompt = useCallback(() => {
    termRef.current?.write("\r\n" + prompt);
    lineBufferRef.current = "";
  }, [prompt]);

  const runCommand = useCallback(
    async (command: string) => {
      const term = termRef.current;
      if (!term) return;
      // cd into home first to ensure a consistent working directory, then run
      // the user's command (mirrors the 12-B convention).
      const fullCommand = command.trim()
        ? `cd /home/daytona && ${command.trim()}`
        : "";
      if (!fullCommand) {
        writePrompt();
        return;
      }
      term.write("\r\n");
      // Show inline spinner while in flight.
      term.write("\x1b[2m…\x1b[0m");
      setBusySync(true);
      try {
        const result = await sandboxesApi.exec(sandboxId, fullCommand);
        // Clear the spinner line.
        term.write("\r\x1b[K");
        if (result.output) {
          // Normalise CRLF — xterm needs \r\n for newlines.
          const out = result.output.replace(/\r?\n/g, "\r\n");
          term.write(out);
        }
        if (result.exitCode !== 0) {
          term.write(`\r\n\x1b[2mexit ${result.exitCode}\x1b[0m`);
        }
      } catch (err: unknown) {
        term.write("\r\x1b[K");
        const msg = err instanceof Error ? err.message : String(err);
        term.write(`\r\n\x1b[31mError: ${msg}\x1b[0m`);
      } finally {
        setBusySync(false);
        writePrompt();
      }
    },
    [sandboxId, writePrompt, setBusySync],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    // Dynamic imports keep SSR happy — xterm touches `window` at module init.
    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!mounted || !containerRef.current) return;

      const term = new Terminal({
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontSize: 13,
        theme: {
          background: "#0d0d0d",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          selectionBackground: "#264f78",
        },
        cursorBlink: true,
        convertEol: false,
        scrollback: 1000,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();

      termRef.current = term;
      fitRef.current = fit;

      // Welcome banner.
      term.write(
        `\x1b[1;32mOneComputer\x1b[0m sandbox console — \x1b[2m${sandboxId}\x1b[0m\r\n`,
      );
      term.write(prompt);

      // Key handling.
      term.onKey(({ key, domEvent }) => {
        if (busyRef.current) return; // block input while exec is in flight

        const printable =
          !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

        if (domEvent.key === "Enter") {
          const line = lineBufferRef.current;
          lineBufferRef.current = "";
          void runCommand(line);
        } else if (domEvent.key === "Backspace") {
          if (lineBufferRef.current.length > 0) {
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
            term.write("\b \b");
          }
        } else if (printable && key.length === 1) {
          lineBufferRef.current += key;
          term.write(key);
        }
      });

      // Resize observer.
      const ro = new ResizeObserver(() => {
        fitRef.current?.fit();
      });
      if (containerRef.current) ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxId]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="rounded-md overflow-hidden"
        style={{ height: "320px", background: "#0d0d0d" }}
        aria-label="Sandbox command console"
      />
      {busy && (
        <p className="text-xs text-muted-foreground">Running command…</p>
      )}
      <p className="text-xs text-muted-foreground">
        Command console — one command per line, runs via governed exec. Not a
        full interactive shell.
      </p>
    </div>
  );
};
