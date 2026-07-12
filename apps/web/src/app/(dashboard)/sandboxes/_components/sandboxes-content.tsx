"use client";

import { useEffect, useState, useCallback, useId } from "react";
import Link from "next/link";
import { Button } from "@onecli/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@onecli/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@onecli/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@onecli/ui/components/dropdown-menu";
import { Input } from "@onecli/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@onecli/ui/components/tooltip";
import type { SandboxInfo } from "@/lib/api/sandboxes";
import { sandboxesApi } from "@/lib/api/sandboxes";
import { usePersonaRole } from "@/hooks/use-persona-role";
import { StateBadge } from "./state-badge";

function ExecDialog({ sandbox }: { sandbox: SandboxInfo }) {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<{
    exitCode: number;
    output: string;
  } | null>(null);
  const [running, setRunning] = useState(false);

  // Step-up gate UX hint: certain exec keywords suggest an action that the
  // gateway may route to manager approval (outlook.send_email, calendar write,
  // large data export, etc.). The real gate lives in the gateway via PolicyRule;
  // this is only a heads-up so the operator isn't surprised by a queued request.
  const APPROVAL_KEYWORDS = [
    "send",
    "email",
    "outlook",
    "calendar write",
    "calendar",
    "export",
  ];
  const mayRequireApproval = APPROVAL_KEYWORDS.some((kw) =>
    command.toLowerCase().includes(kw),
  );

  const run = async () => {
    if (!command.trim()) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await sandboxesApi.exec(sandbox.id, command);
      setOutput(res);
    } catch {
      setOutput({ exitCode: 1, output: "Failed to reach toolbox" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Execute in {sandbox.name}</DialogTitle>
        <DialogDescription>
          Run a command inside the sandbox via the toolbox API.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="echo hello"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            className="font-mono text-sm"
          />
          <Button onClick={run} disabled={running || !command.trim()}>
            {running ? "Running…" : "Run"}
          </Button>
        </div>
        {mayRequireApproval && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
            This action may require manager approval. The request will be queued
            if policy requires it.
          </div>
        )}
        {output && (
          <div className="rounded-md bg-muted p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Exit code:</span>
              <span
                className={`text-xs font-mono font-semibold ${
                  output.exitCode === 0 ? "text-green-600" : "text-destructive"
                }`}
              >
                {output.exitCode}
              </span>
            </div>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">
              {output.output}
            </pre>
          </div>
        )}
      </div>
    </DialogContent>
  );
}

function NewSandboxDialog({
  onCreated,
}: {
  onCreated: (s: SandboxInfo) => void;
}) {
  const [open, setOpen] = useState(false);
  const generatedId = useId()
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 6);
  const [name, setName] = useState(`sandbox-${generatedId}`);
  const [status, setStatus] = useState<
    "idle" | "creating" | "installing" | "ready" | "error"
  >("idle");
  const [error, setError] = useState("");

  const create = async () => {
    setStatus("creating");
    setError("");
    try {
      const sandbox = await sandboxesApi.create(name);
      setStatus("installing");
      // Poll until started or error
      let attempts = 0;
      while (attempts < 36) {
        await new Promise((r) => setTimeout(r, 5000));
        const updated = await sandboxesApi.get(sandbox.id);
        if (updated.state === "started") {
          setStatus("ready");
          onCreated(updated);
          setTimeout(() => setOpen(false), 1500);
          return;
        }
        if (updated.state === "error") {
          setError("Sandbox failed to start");
          setStatus("error");
          return;
        }
        attempts++;
      }
      setError("Timed out waiting for sandbox to start");
      setStatus("error");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  const statusMessage = {
    idle: null,
    creating: "Creating sandbox…",
    installing: "Installing Claude Desktop Linux and Claude Code…",
    ready: "Ready! Desktop, Claude Desktop Linux, and Claude Code verified ✓",
    error: null,
  }[status];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New Sandbox</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Boot a new sandbox</DialogTitle>
          <DialogDescription>
            Creates a sandboxed desktop with native Claude Desktop Linux and
            Claude Code available when bootstrap succeeds.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="sandbox-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status !== "idle" && status !== "error"}
          />
          {statusMessage && (
            <p className="text-sm text-muted-foreground">{statusMessage}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
            Local demo mode: desktop streaming is provided by the configured
            sandbox provider. Native Claude Desktop is only marked healthy after
            the Linux app is installed and running.
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={status === "creating" || status === "installing"}
          >
            Cancel
          </Button>
          <Button
            onClick={create}
            disabled={
              status === "creating" || status === "installing" || !name.trim()
            }
          >
            {status === "creating" || status === "installing"
              ? "Booting…"
              : "Boot Sandbox"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SandboxesContent({
  initialSandboxes,
  currentUserId,
}: {
  initialSandboxes: SandboxInfo[];
  /** The authenticated user's id — used to gate own-sandbox-only delete for Employee role. */
  currentUserId?: string;
}) {
  const [sandboxes, setSandboxes] = useState<SandboxInfo[]>(initialSandboxes);
  const [now, setNow] = useState(0);
  const [execTarget, setExecTarget] = useState<SandboxInfo | null>(null);
  const role = usePersonaRole();

  const refresh = useCallback(async () => {
    try {
      const list = await sandboxesApi.list();
      if (Array.isArray(list)) setSandboxes(list);
    } catch {
      // Daytona unreachable — keep existing list
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(refresh, 5000);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, [refresh]);

  const deleteSandbox = async (id: string) => {
    if (!confirm("Stop and delete this sandbox?")) return;
    try {
      await sandboxesApi.delete(id);
      setSandboxes((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
  };

  const uptime = (createdAt?: string) => {
    if (!createdAt) return "—";
    const diff = now - new Date(createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sandboxes</h1>
          <p className="text-sm text-muted-foreground">
            Browser-accessible sandboxed computers with Claude Desktop Linux,
            Claude Code, and governed actions.
          </p>
        </div>
        <NewSandboxDialog
          onCreated={(s) => setSandboxes((prev) => [s, ...prev])}
        />
      </div>

      {/* Empty state */}
      {sandboxes.length === 0 && (
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="flex flex-col items-center gap-4 pt-6 text-center">
            <div className="rounded-full bg-muted p-4">
              <svg
                className="h-8 w-8 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3"
                />
              </svg>
            </div>
            <div>
              <p className="font-medium">No sandboxes running</p>
              <p className="text-sm text-muted-foreground">
                Boot your first remote desktop sandbox to get started.
              </p>
            </div>
            <NewSandboxDialog onCreated={(s) => setSandboxes([s])} />
          </CardContent>
        </Card>
      )}

      {/* Sandbox table */}
      {sandboxes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {sandboxes.length} sandbox{sandboxes.length !== 1 ? "es" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {sandboxes.map((s) => (
                <div key={s.id} className="flex items-center gap-4 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/sandboxes/${s.id}?persona=${role}`}
                      className="truncate font-medium text-sm hover:underline"
                    >
                      {s.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s.id.slice(0, 8)}…
                    </p>
                  </div>
                  <StateBadge state={s.state} />
                  {s.desktopReady && (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={s.desktopUrl ?? `/sandboxes/${s.id}`}
                        target={s.desktopUrl ? "_blank" : undefined}
                        rel="noreferrer"
                      >
                        Open Desktop
                      </a>
                    </Button>
                  )}
                  {s.claudeVersion && (
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      Claude {s.claudeVersion}
                    </span>
                  )}
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {uptime(s.createdAt)}
                  </span>
                  <Dialog onOpenChange={(o) => !o && setExecTarget(null)}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          ⋯
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Exec terminal — gated on sandbox running AND policy */}
                        {s.state !== "started" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <DropdownMenuItem disabled>
                                  Exec terminal
                                </DropdownMenuItem>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Sandbox must be running to exec
                            </TooltipContent>
                          </Tooltip>
                        ) : role === "member" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <DropdownMenuItem disabled>
                                  Exec terminal
                                </DropdownMenuItem>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Gateway policy blocks this action
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <DialogTrigger asChild>
                            <DropdownMenuItem onSelect={() => setExecTarget(s)}>
                              Exec terminal
                            </DropdownMenuItem>
                          </DialogTrigger>
                        )}

                        {/* Delete — Employee can only delete their own sandboxes */}
                        {role === "member" &&
                        currentUserId &&
                        (s as SandboxInfo & { ownerId?: string }).ownerId &&
                        (s as SandboxInfo & { ownerId?: string }).ownerId !==
                          currentUserId ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <DropdownMenuItem
                                  disabled
                                  className="text-destructive focus:text-destructive"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Employees can only delete their own sandboxes
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => deleteSandbox(s.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {execTarget?.id === s.id && <ExecDialog sandbox={s} />}
                  </Dialog>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Honest gaps notice */}
      <p className="text-xs text-muted-foreground">
        Remote desktop streaming is real when the sandbox provider returns a
        desktop URL. Raw VNC interactions are not command-level governed;
        OneComputer governs lifecycle, exec, and explicit policy actions.
      </p>
    </div>
  );
}
