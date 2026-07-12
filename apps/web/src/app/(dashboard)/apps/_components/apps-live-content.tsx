"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Code2,
  Container,
  Download,
  ExternalLink,
  Globe2,
  Hash,
  Loader2,
  Power,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCog,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@onecli/ui/components/dialog";
import { formatRelative, formatUTC } from "@onecli/api/lib/format";
import { DeployWizard } from "./deploy-wizard";

// --- Types ----------------------------------------------------------------

/**
 * Shape returned by GET /v1/apps/deployed. Mirrors `DeployedApp` in
 * packages/api/src/routes/deployed-apps.ts. Declared locally so the web app
 * does not take a runtime dependency on the api package's route file.
 */
interface DeployedApp {
  id: string;
  name: string;
  type: "streamlit" | "react" | "node" | "python" | "unknown";
  status: "running" | "stopped" | "deploying" | "error";
  url?: string;
  owner: string;
  dataClass: string;
  createdAt: string;
  evidenceHash?: string;
}

interface DeployedAppsResponse {
  apps: DeployedApp[];
}

const DEPLOYED_URL = "/v1/apps/deployed";
const POLL_INTERVAL_MS = 15_000;

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Display helpers ------------------------------------------------------

const TYPE_ICON = {
  streamlit: Container,
  react: Code2,
  node: Terminal,
  python: Terminal,
  unknown: ShieldCheck,
} as const satisfies Record<DeployedApp["type"], typeof Container>;

const TYPE_LABEL = {
  streamlit: "Streamlit",
  react: "React",
  node: "Node.js",
  python: "Python",
  unknown: "Unknown",
} as const satisfies Record<DeployedApp["type"], string>;

interface StatusConfig {
  label: string;
  className: string;
  spinner?: boolean;
}

const STATUS_CONFIG: Record<DeployedApp["status"], StatusConfig> = {
  running: {
    label: "Running",
    className: "bg-green-500/15 text-green-700 dark:text-green-400",
  },
  stopped: {
    label: "Stopped",
    className: "bg-muted text-muted-foreground",
  },
  deploying: {
    label: "Deploying",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    spinner: true,
  },
  error: {
    label: "Error",
    className: "bg-destructive/15 text-destructive",
  },
};

function StatusBadge({ status }: { status: DeployedApp["status"] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}
    >
      {cfg.spinner && <Loader2 className="size-3 animate-spin" />}
      {cfg.label}
    </span>
  );
}

function TypeBadge({ type }: { type: DeployedApp["type"] }) {
  return <Badge variant="outline">{TYPE_LABEL[type]}</Badge>;
}

const truncateHash = (hash: string | undefined): string => {
  if (!hash) return "—";
  return hash.length > 20 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash;
};

// --- Actions --------------------------------------------------------------

function exportEvidence(app: DeployedApp) {
  const evidence = {
    exportedAt: new Date().toISOString(),
    name: app.name,
    owner: app.owner,
    dataClass: app.dataClass,
    evidenceHash: app.evidenceHash ?? null,
    createdAt: app.createdAt,
  };
  const blob = new Blob([JSON.stringify(evidence, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evidence-${app.name}-${app.id.slice(0, 8)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function stopApp(app: DeployedApp) {
  // Stub: the stop endpoint (POST /v1/apps/deployed/:id/stop) is not yet
  // implemented on the API side. Surface this honestly to the operator
  // rather than silently no-op'ing.
  toast.info(`Stop not yet implemented for "${app.name}".`);
}

function openApp(app: DeployedApp) {
  if (!app.url) {
    toast.error("This app has no governed URL yet.");
    return;
  }
  window.open(app.url, "_blank", "noopener,noreferrer");
}

// --- App passport modal ---------------------------------------------------

function AppPassportDialog({
  app,
  open,
  onOpenChange,
}: {
  app: DeployedApp | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!app) return null;
  const TypeIcon = TYPE_ICON[app.type];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg border bg-background">
              <TypeIcon className="size-4 text-brand" />
            </span>
            {app.name}
            <TypeBadge type={app.type} />
          </DialogTitle>
          <DialogDescription>
            App passport — owner, classification, governed URL, and evidence for
            this deployed runtime.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-xs">
          <PassportRow icon={UserCog} label="Owner" value={app.owner} />
          <PassportRow
            icon={ShieldCheck}
            label="Data classification"
            value={app.dataClass}
          />
          <PassportRow
            icon={Clock}
            label="Created"
            value={formatUTC(app.createdAt)}
            hint={`(${localTz})`}
          />
          <PassportRow
            icon={Globe2}
            label="Governed URL"
            value={
              app.url ? (
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-brand underline-offset-4 hover:underline"
                >
                  {app.url}
                </a>
              ) : (
                "No URL available"
              )
            }
          />
          <PassportRow
            icon={Hash}
            label="Evidence hash"
            value={
              <span className="font-mono">
                {truncateHash(app.evidenceHash)}
              </span>
            }
          />
          <PassportRow
            icon={ShieldCheck}
            label="Status"
            value={<StatusBadge status={app.status} />}
          />
          <PassportRow
            icon={Clock}
            label="Last deployed"
            value={formatRelative(app.createdAt)}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportEvidence(app)}
          >
            <Download className="size-3.5" /> Export Evidence
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              stopApp(app);
              onOpenChange(false);
            }}
          >
            <Power className="size-3.5" /> Stop
          </Button>
          <Button
            size="sm"
            onClick={() => {
              openApp(app);
              onOpenChange(false);
            }}
            disabled={!app.url}
          >
            <ExternalLink className="size-3.5" /> Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PassportRow({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof UserCog;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="break-words font-medium">
        {value}
        {hint && <span className="ml-1 text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

// --- App card -------------------------------------------------------------

function AppCard({
  app,
  onOpenPassport,
}: {
  app: DeployedApp;
  onOpenPassport: (app: DeployedApp) => void;
}) {
  const TypeIcon = TYPE_ICON[app.type];
  return (
    <Card
      className="cursor-pointer p-4 transition-colors hover:bg-accent/40"
      onClick={() => onOpenPassport(app)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
            <TypeIcon className="size-4 text-brand" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{app.name}</p>
            <p className="text-xs text-muted-foreground">
              {TYPE_LABEL[app.type]} runtime
            </p>
          </div>
        </div>
        <StatusBadge status={app.status} />
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <UserCog className="size-3.5" />
          <span className="truncate">{app.owner}</span>
        </div>
        {app.url ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Globe2 className="size-3.5 shrink-0" />
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="break-all text-brand underline-offset-4 hover:underline"
            >
              {app.url}
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            <Globe2 className="size-3.5 shrink-0" />
            <span>No URL available</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Hash className="size-3.5 shrink-0" />
          <span className="break-all font-mono">
            {truncateHash(app.evidenceHash)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={(e) => {
            e.stopPropagation();
            openApp(app);
          }}
          disabled={!app.url}
        >
          <ExternalLink className="size-3.5" /> Open
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={(e) => {
            e.stopPropagation();
            stopApp(app);
          }}
        >
          <Power className="size-3.5" /> Stop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          onClick={(e) => {
            e.stopPropagation();
            exportEvidence(app);
          }}
        >
          <Download className="size-3.5" /> Export
        </Button>
      </div>
    </Card>
  );
}

// --- Empty state ----------------------------------------------------------

function EmptyState() {
  return (
    <Card className="border-brand/30 bg-gradient-to-br from-brand/10 via-background to-background p-8 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-full border bg-background">
          <Rocket className="size-6 text-brand" />
        </span>
        <h2 className="text-xl font-semibold tracking-tight">
          No apps deployed yet.
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Deploy your first app to see it here with its governed URL, owner,
          evidence hash, and runtime status.
        </p>
        <Button size="sm" className="mt-1" asChild>
          <a href="/apps#deploy">
            <Sparkles className="size-3.5" /> Open deploy wizard
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          The deploy wizard (Sprint D deploy phase) will guide you through
          runtime selection, owner assignment, and data classification.
        </p>
      </div>
    </Card>
  );
}

// --- Main component -------------------------------------------------------

export const AppsLiveContent = () => {
  const [apps, setApps] = useState<DeployedApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [passportApp, setPassportApp] = useState<DeployedApp | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(DEPLOYED_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: DeployedAppsResponse = await res.json();
      setApps(Array.isArray(data.apps) ? data.apps : []);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deployed apps");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const running = apps.filter((a) => a.status === "running").length;
  const errorCount = apps.filter((a) => a.status === "error").length;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Summary + refresh bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 text-brand">
            <ShieldCheck className="size-3" /> Deployed apps
          </Badge>
          <Badge variant="outline">{apps.length} total</Badge>
          <Badge
            variant="outline"
            className={
              running > 0
                ? "border-green-500/30 text-green-700 dark:text-green-400"
                : ""
            }
          >
            {running} running
          </Badge>
          {errorCount > 0 && (
            <Badge
              variant="outline"
              className="border-destructive/30 text-destructive"
            >
              {errorCount} error
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button size="sm" onClick={() => setDeployOpen(true)}>
            <Rocket className="size-3.5" /> Deploy app
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading && apps.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : error && apps.length === 0 ? (
        <Card className="border-red-500/30 bg-red-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle className="size-4" /> Failed to load deployed apps:{" "}
            {error}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setIsLoading(true);
              void refresh();
            }}
          >
            Retry
          </Button>
        </Card>
      ) : apps.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4" /> Background refresh failed:{" "}
              {error}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} onOpenPassport={setPassportApp} />
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Live list from <code className="font-mono">GET /v1/apps/deployed</code>.
        Polls every 15s.
      </p>

      <AppPassportDialog
        app={passportApp}
        open={passportApp !== null}
        onOpenChange={(o) => !o && setPassportApp(null)}
      />

      <DeployWizard
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onDeployed={() => void refresh()}
      />
    </div>
  );
};
