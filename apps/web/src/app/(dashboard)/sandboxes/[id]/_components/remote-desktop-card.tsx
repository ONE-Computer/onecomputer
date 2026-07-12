"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@onecli/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import type { SandboxDesktopInfo, SandboxInfo } from "@/lib/api/sandboxes";
import { sandboxesApi } from "@/lib/api/sandboxes";

const Bool = ({ ok, label }: { ok: boolean; label: string }) => (
  <span
    className={`rounded-full px-2 py-0.5 text-xs ${
      ok
        ? "bg-green-500/15 text-green-700 dark:text-green-400"
        : "bg-muted text-muted-foreground"
    }`}
  >
    {label}: {ok ? "ok" : "pending"}
  </span>
);

export function RemoteDesktopCard({ sandbox }: { sandbox: SandboxInfo }) {
  const [desktop, setDesktop] = useState<SandboxDesktopInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDesktop(await sandboxesApi.desktop(sandbox.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sandbox.id]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10000);
    return () => clearInterval(id);
  }, [load]);

  const restart = async () => {
    setRestarting(true);
    setError("");
    try {
      setDesktop(await sandboxesApi.restartDesktop(sandbox.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };

  const url = desktop?.desktopUrl ?? sandbox.desktopUrl;
  const ready = desktop?.desktopReady ?? sandbox.desktopReady ?? false;
  const health = desktop?.health ?? sandbox.desktopHealth;

  const openDesktop = useCallback(() => {
    if (!url) return;
    // Open the noVNC desktop in a new browser tab. KasmVNC serves a
    // self-signed cert, so the user may need to accept it once in the new tab
    // before the desktop renders. window.open keeps the sandbox detail page in
    // place while the desktop runs alongside it.
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      // Popup blocked — fall back to a direct navigation as a last resort.
      window.location.href = url;
    }
  }, [url]);

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>Remote Desktop</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              ready
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }`}
          >
            {ready ? "Desktop ready" : "Booting desktop"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-4">
          <p className="text-sm font-medium">Real noVNC desktop session</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is the cornerstone computer UX: a Linux desktop via VNC/noVNC.
            Claude Desktop Linux is launched inside the sandbox when health
            shows it running. Claude Code is also available in the sandbox
            terminal when bootstrap succeeds.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {health ? (
            <>
              <Bool ok={health.vnc} label="VNC" />
              <Bool ok={health.noVnc} label="noVNC" />
              <Bool ok={health.claudeCode} label="Claude Code" />
              <Bool
                ok={health.claudeDesktopInstalled ?? false}
                label="Claude Desktop installed"
              />
              <Bool
                ok={health.claudeDesktopRunning ?? false}
                label="Claude Desktop running"
              />
              <Bool
                ok={health.claudeDesktop3pConfigured ?? false}
                label="3P config"
              />
              <Bool ok={health.llmProxyReachable ?? false} label="LLM proxy" />
              <Bool ok={health.dockerAvailable ?? false} label="Docker" />
              <Bool ok={health.browser} label="Browser" />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {loading ? "Checking desktop health…" : "Desktop health unknown"}
            </span>
          )}
        </div>

        {desktop?.claudeVersion && (
          <p className="text-xs text-muted-foreground">
            Claude Code: {desktop.claudeVersion}
          </p>
        )}

        {desktop?.llmProxy && (
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">ONEComputer LLM proxy</p>
            <p>Mode: {desktop.llmProxy.mode}</p>
            {desktop.llmProxy.baseUrl && (
              <p>Base URL: {desktop.llmProxy.baseUrl}</p>
            )}
            <p>
              Status: {desktop.llmProxy.reachable ? "reachable" : "unreachable"}
            </p>
            {typeof desktop.llmProxy.modelCount === "number" && (
              <p>Models discovered: {desktop.llmProxy.modelCount}</p>
            )}
            {desktop.llmProxy.configuredModels?.length ? (
              <p>
                Configured models:{" "}
                {desktop.llmProxy.configuredModels.join(", ")}
              </p>
            ) : null}
            {desktop.llmProxy.logHint && (
              <p>Monitoring: {desktop.llmProxy.logHint}</p>
            )}
            {desktop.llmProxy.error && (
              <p className="text-destructive">
                Proxy error: {desktop.llmProxy.error}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button onClick={openDesktop} disabled={!ready || !url}>
            Open Desktop
          </Button>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "Checking…" : "Refresh health"}
          </Button>
          <Button variant="outline" onClick={restart} disabled={restarting}>
            {restarting ? "Bootstrapping…" : "Restart desktop bootstrap"}
          </Button>
        </div>

        {!url && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Desktop services can run inside the sandbox, but no external noVNC
            URL is configured yet. Set DAYTONA_DESKTOP_URL_TEMPLATE or implement
            the WebSocket reverse proxy after confirming Daytona port exposure.
          </p>
        )}

        {desktop?.bootLogTail && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Boot log tail
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {desktop.bootLogTail}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
