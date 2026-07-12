import {
  AlertTriangle,
  ClipboardCheck,
  Eye,
  FileText,
  KeyRound,
  LockKeyhole,
  PauseCircle,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { PageHeader } from "@dashboard/page-header";
import { buildCisoUserPrivacyConsolePayload } from "@onecli/api/services/ciso-privacy-console-service";

const shortHash = (value: string) =>
  value.length > 18 ? `${value.slice(0, 14)}…${value.slice(-4)}` : value;

export function CisoPrivacyConsole() {
  const payload = buildCisoUserPrivacyConsolePayload();
  const { cisoView, userPrivacyView } = payload;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-x-hidden">
      <PageHeader
        title="CISO / Privacy Console"
        description="Operational view for governed AI coworkers, personal connector grants, evidence, and revoke actions. CISO sees metadata and risk; users inspect their own personal data usage."
      />

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="overflow-hidden border-brand/30 bg-brand/5">
          <div className="border-b bg-background/70 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="gap-1" variant="secondary">
                <ShieldCheck className="size-3.5" /> Security operations
              </Badge>
              <Badge variant="outline">P6.2 preview</Badge>
              <Badge variant="outline">Score 90/100</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Agent risk, control state, and evidence without private-content
              spillover.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              This console separates cyber oversight from personal privacy.
              Security teams can pause, revoke, and export evidence for AI
              coworkers, but raw personal connector content stays out of the
              CISO view unless a separate incident-access process is approved.
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <Metric
              label="Governed agents"
              value={String(cisoView.agents.length)}
            />
            <Metric
              label="Raw personal content"
              value={cisoView.rawPersonalContentVisible ? "Visible" : "Hidden"}
              tone="safe"
            />
            <Metric
              label="Raw credentials"
              value={cisoView.rawCredentialVisible ? "Visible" : "Hidden"}
              tone="safe"
            />
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-brand" />
            <h3 className="text-sm font-semibold">Privacy boundary</h3>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <BoundaryRow
              label="CISO view"
              value="Metadata, risk, evidence hashes"
            />
            <BoundaryRow
              label="User view"
              value="Personal grants + data used"
            />
            <BoundaryRow
              label="Incident access"
              value="Separate approval required"
            />
          </div>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand" />
            <h2 className="text-lg font-semibold tracking-tight">
              CISO command queue
            </h2>
          </div>
          {cisoView.agents.map((agent) => (
            <Card key={agent.agentId} className="min-w-0 overflow-hidden p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        agent.riskTier === "critical"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {agent.riskTier.toUpperCase()} risk
                    </Badge>
                    <Badge variant="outline">{agent.status}</Badge>
                    <Badge variant="outline">
                      {agent.workflows.length} workflow
                    </Badge>
                  </div>
                  <h3 className="mt-3 text-base font-semibold">
                    {agent.agentId}
                  </h3>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {agent.agentDid}
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:w-auto lg:flex lg:flex-wrap lg:justify-end">
                  {agent.actions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="outline"
                      className="justify-center whitespace-normal text-center"
                    >
                      {action === "pause" && (
                        <PauseCircle className="size-3.5" />
                      )}
                      {action === "revoke" && (
                        <RotateCcw className="size-3.5" />
                      )}
                      {action === "export_evidence" && (
                        <FileText className="size-3.5" />
                      )}
                      {action === "request_incident_access" && (
                        <KeyRound className="size-3.5" />
                      )}
                      {action.replaceAll("_", " ")}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <ClipboardCheck className="size-4 text-brand" /> Controls
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {agent.controls.map((control) => (
                      <Badge
                        key={control}
                        variant="outline"
                        className="font-normal"
                      >
                        {control.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <FileText className="size-4 text-brand" /> Evidence heads
                  </div>
                  <div className="space-y-1.5">
                    {agent.evidenceHashes.slice(0, 4).map((hash) => (
                      <div
                        key={hash}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        {shortHash(hash)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <UserCheck className="size-5 text-brand" />
            <h2 className="text-lg font-semibold tracking-tight">
              User privacy console
            </h2>
          </div>
          <Card className="min-w-0 overflow-hidden p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{userPrivacyView.userId}</Badge>
              <Badge variant="outline">Pause/revoke enabled</Badge>
              <Badge variant="outline">Inspect data used</Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Users can see their personal connector grants, what was retrieved,
              and revoke access without waiting for cyber operations.
            </p>
          </Card>

          {userPrivacyView.grants.map((grant) => (
            <Card key={grant.grantHash} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Eye className="size-4 text-brand" />
                    <h3 className="text-sm font-semibold">
                      {grant.connectorKind}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {grant.purpose}
                  </p>
                </div>
                <Badge variant="outline">{grant.status}</Badge>
              </div>
              <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <SearchCheck className="size-3.5" /> Data used
                </div>
                {grant.dataUsed.map((use) => (
                  <div key={use.retrievalHash} className="space-y-2">
                    <div className="font-mono text-xs text-muted-foreground">
                      {shortHash(use.retrievalHash)}
                    </div>
                    {use.snippets.map((snippet) => (
                      <div
                        key={snippet.itemId}
                        className="rounded-md border bg-background p-3"
                      >
                        <div className="text-sm font-medium">
                          {snippet.title}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {snippet.snippet}
                        </p>
                        <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                          {snippet.sourceUriHash}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {grant.userActions.map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    className="justify-center whitespace-normal text-center"
                  >
                    {action.replaceAll("_", " ")}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Card className="border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div>
            <h2 className="text-sm font-semibold">Incident-access rule</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              CISO export is metadata-only by default. Raw personal content
              requires a separate incident/legal approval process; this UI
              intentionally does not provide a casual “view private content”
              button.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

const Metric = ({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "safe";
}) => (
  <div className="rounded-xl border bg-background p-3">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div
      className={
        tone === "safe"
          ? "mt-1 text-lg font-semibold text-brand"
          : "mt-1 text-lg font-semibold"
      }
    >
      {value}
    </div>
  </div>
);

const BoundaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 p-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="max-w-44 text-right font-medium">{value}</span>
  </div>
);
