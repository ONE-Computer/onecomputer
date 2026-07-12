"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Code2,
  Container,
  Globe2,
  Loader2,
  Rocket,
  ShieldCheck,
  Terminal,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@onecli/ui/components/dialog";
import { Input } from "@onecli/ui/components/input";
import { Label } from "@onecli/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onecli/ui/components/select";
import { useAuth } from "@/providers/auth-provider";

// --- Types ----------------------------------------------------------------

type AppType = "streamlit" | "react" | "node" | "python";
type DataClass = "public" | "internal" | "confidential" | "restricted";
type Step = 1 | 2 | 3;

interface DeployResponse {
  ok: true;
  jobId: string;
  status: "deploying";
  message: string;
}

interface DeployErrorBody {
  error?: string;
}

// --- Constants -------------------------------------------------------------

const APP_TYPES: { value: AppType; label: string; icon: typeof Container }[] = [
  { value: "streamlit", label: "Streamlit", icon: Container },
  { value: "react", label: "React", icon: Code2 },
  { value: "node", label: "Node.js", icon: Terminal },
  { value: "python", label: "Python", icon: Terminal },
];

const DATA_CLASSES: DataClass[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

const DEFAULT_EXPIRY_DAYS = 90;
const DEPLOY_ENDPOINT = "/v1/apps/deploy";

const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// --- Helpers ---------------------------------------------------------------

/**
 * Infer the app type from a GitHub URL or repo path. Looks at the URL slug and
 * common keywords. Returns `null` when no signal is found so the caller can
 * prompt the user to pick manually.
 */
function detectAppType(url: string): AppType | null {
  const v = url.toLowerCase();
  if (v.includes("streamlit")) return "streamlit";
  if (v.includes("react") || v.includes("next")) return "react";
  if (v.includes("node") || v.includes("express")) return "node";
  if (
    v.includes("python") ||
    v.includes("flask") ||
    v.includes("fastapi") ||
    v.includes("django")
  ) {
    return "python";
  }
  return null;
}

/** Derive a human-friendly app name from a GitHub URL slug. */
function nameFromUrl(url: string): string {
  const match = url.match(/github\.com[:/]+[^/]+\/([^/?#]+)/i);
  const slug = match?.[1];
  if (slug) return slug.replace(/\.git$/i, "");
  // Fallback: last path segment, stripped of query/extension.
  const seg = url.split(/[/?#]/).filter(Boolean).pop();
  return seg ? seg.replace(/\.git$/i, "") : "my-app";
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// --- Component -------------------------------------------------------------

export interface DeployWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Notified after a deploy is successfully queued (e.g. to refresh the list). */
  onDeployed?: (jobId: string) => void;
}

export const DeployWizard = ({
  open,
  onOpenChange,
  onDeployed,
}: DeployWizardProps) => {
  const { user } = useAuth();
  const defaultOwner = user?.email ?? "";

  const [step, setStep] = useState<Step>(1);
  const [sourceUrl, setSourceUrl] = useState("");
  const [appType, setAppType] = useState<AppType | "">("");
  const [owner, setOwner] = useState(defaultOwner);
  const [dataClass, setDataClass] = useState<DataClass | "">("");
  const [users, setUsers] = useState("");
  const [deploying, setDeploying] = useState(false);

  const expiry = useMemo(() => addDays(new Date(), DEFAULT_EXPIRY_DAYS), []);

  const detected = useMemo(
    () => (sourceUrl.trim() ? detectAppType(sourceUrl) : null),
    [sourceUrl],
  );

  // Auto-fill app type when a detection is available and the user hasn't
  // manually picked one yet.
  const effectiveAppType: AppType | "" = appType || detected || "";

  const appName = useMemo(
    () => (sourceUrl.trim() ? nameFromUrl(sourceUrl) : ""),
    [sourceUrl],
  );

  // --- Validation per step ------------------------------------------------

  const step1Valid = sourceUrl.trim().length > 0 && effectiveAppType !== "";
  const step2Valid =
    owner.trim().length > 0 && dataClass !== "" && users.trim().length > 0;
  const canDeploy = step1Valid && step2Valid && !deploying;

  // --- Lifecycle: reset on close -----------------------------------------

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      // Reset wizard state when the dialog closes so a reopen starts fresh.
      setStep(1);
      setSourceUrl("");
      setAppType("");
      setOwner(defaultOwner);
      setDataClass("");
      setUsers("");
      setDeploying(false);
    }
    onOpenChange(next);
  };

  // --- Deploy -------------------------------------------------------------

  const handleDeploy = async () => {
    if (!canDeploy) return;
    // `canDeploy` (via step1Valid) guarantees effectiveAppType is a non-empty
    // AppType; TS narrows it through the boolean, so bind the narrowed value
    // to a const to flow the AppType into the fetch payload.
    const resolvedAppType: AppType = effectiveAppType;
    setDeploying(true);
    try {
      const res = await fetch(DEPLOY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          appType: resolvedAppType,
          owner: owner.trim(),
          dataClass,
          users: users.trim(),
        }),
      });

      if (!res.ok) {
        const err = (await res
          .json()
          .catch(() => null)) as DeployErrorBody | null;
        const msg = err?.error ?? `HTTP ${res.status}`;
        toast.error(`Deploy failed: ${msg}`);
        return;
      }

      const data = (await res.json()) as DeployResponse;
      toast.success(`Deploy queued (job ${data.jobId.slice(0, 8)}).`);
      onDeployed?.(data.jobId);
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to queue deploy");
    } finally {
      setDeploying(false);
    }
  };

  // --- Render --------------------------------------------------------------

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-5 text-brand" />
            Deploy app
          </DialogTitle>
          <DialogDescription>
            Three questions to a governed URL. Step {step} of 3.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={
                "h-1.5 flex-1 rounded-full transition-colors " +
                (s <= step ? "bg-brand" : "bg-muted")
              }
            />
          ))}
        </div>

        {/* Step 1 — Detect app type */}
        {step === 1 && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="deploy-source-url">GitHub URL</Label>
              <Input
                id="deploy-source-url"
                placeholder="https://github.com/org/repo"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                autoFocus
              />
              {detected && appType === "" && (
                <p className="text-xs text-muted-foreground">
                  Detected: <span className="font-medium">{detected}</span>.
                  Override below if wrong.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label>App type</Label>
              <div className="grid grid-cols-2 gap-2">
                {APP_TYPES.map((t) => {
                  const active = effectiveAppType === t.value;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setAppType(t.value)}
                      className={
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors " +
                        (active
                          ? "border-brand bg-brand/10 text-brand"
                          : "hover:bg-accent/40")
                      }
                    >
                      <Icon className="size-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Governance questions */}
        {step === 2 && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="deploy-owner">Owner</Label>
              <Input
                id="deploy-owner"
                placeholder="owner@example.com"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deploy-data-class">Data classification</Label>
              <Select
                value={dataClass}
                onValueChange={(v) => setDataClass(v as DataClass)}
              >
                <SelectTrigger id="deploy-data-class" className="w-full">
                  <SelectValue placeholder="Select classification" />
                </SelectTrigger>
                <SelectContent>
                  {DATA_CLASSES.map((dc) => (
                    <SelectItem key={dc} value={dc}>
                      {dc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deploy-users">Intended users</Label>
              <Input
                id="deploy-users"
                placeholder='e.g. "Finance team"'
                value={users}
                onChange={(e) => setUsers(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 3 — Deploy preview */}
        {step === 3 && (
          <div className="grid gap-2 text-sm">
            <PreviewRow icon={Globe2} label="App name" value={appName || "—"} />
            <PreviewRow
              icon={Container}
              label="Type"
              value={effectiveAppType || "—"}
            />
            <PreviewRow icon={UserCog} label="Owner" value={owner || "—"} />
            <PreviewRow
              icon={ShieldCheck}
              label="Data class"
              value={dataClass || "—"}
            />
            <PreviewRow
              icon={Users}
              label="Intended users"
              value={users || "—"}
            />
            <PreviewRow
              icon={ShieldCheck}
              label="Expiry"
              value={`${expiry.toLocaleString()} (${localTz})`}
              hint={`default ${DEFAULT_EXPIRY_DAYS} days`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Deploying queues a job against{" "}
              <code className="font-mono">POST /v1/apps/deploy</code>. The
              governed URL appears here once the runtime is live.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={deploying}
            >
              <ArrowLeft className="size-3.5" /> Back
            </Button>
          )}
          {step < 3 && (
            <Button
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 ? !step1Valid : !step2Valid}
            >
              Next <ArrowRight className="size-3.5" />
            </Button>
          )}
          {step === 3 && (
            <Button onClick={handleDeploy} disabled={!canDeploy}>
              {deploying ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Deploying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-3.5" /> Deploy
                </>
              )}
            </Button>
          )}
        </DialogFooter>

        {/* Step badges */}
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            Step {step}/3
          </Badge>
          {step === 1 && (
            <Badge variant="secondary" className="text-xs">
              Detect
            </Badge>
          )}
          {step === 2 && (
            <Badge variant="secondary" className="text-xs">
              Govern
            </Badge>
          )}
          {step === 3 && (
            <Badge variant="secondary" className="text-xs">
              Preview
            </Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

function PreviewRow({
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
