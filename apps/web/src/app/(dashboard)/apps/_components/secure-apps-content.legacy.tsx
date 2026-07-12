import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Code2,
  Container,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Hash,
  KeyRound,
  LockKeyhole,
  LucideIcon,
  PackageCheck,
  Rocket,
  Route,
  Server,
  ShieldCheck,
  ShieldEllipsis,
  Sparkles,
  Terminal,
  UserCog,
  UserRound,
} from "lucide-react";
import { Badge } from "@onecli/ui/components/badge";
import { Button } from "@onecli/ui/components/button";
import { Card } from "@onecli/ui/components/card";
import { Progress } from "@onecli/ui/components/progress";

const governedUrl =
  "https://on-b13d1c62c4654e65acb04540a1f6369c.ecs.ap-southeast-1.on.aws";
const nodeDynamoUrl =
  "https://on-a1553bbd0c64408b841d946a146a0c21.ecs.ap-southeast-1.on.aws";
const reactUrl =
  "https://on-ca5cf2e7eca7460eba0614e73904b275.ecs.ap-southeast-1.on.aws";
const cisoGatewayUrl =
  "https://on-77f47f19482d4cef85f9c65644f2a244.ecs.ap-southeast-1.on.aws";
const originProtectedUrl =
  "https://on-f84d3a67818447dc91f7820dae4d7716.ecs.ap-southeast-1.on.aws";

const governedComputers = [
  {
    name: "Meeting Tracker",
    type: "Streamlit runtime",
    url: governedUrl,
    owner: "Local builder",
    linkedAgent: "Meeting tracker app agent",
    status: "Live",
    risk: "Medium",
    verifier: "Gateway grant / VTI-ready",
    secrets: "Origin token injected",
    policy: "sha256:streamlit-policy",
    evidence: "sha256:streamlit-evidence",
  },
  {
    name: "Task Tracker API",
    type: "Node.js + DynamoDB",
    url: nodeDynamoUrl,
    owner: "Local builder",
    linkedAgent: "Builder app worker",
    status: "Live",
    risk: "Medium",
    verifier: "Gateway grant / VTI-ready",
    secrets: "Task role scoped to table",
    policy: "sha256:node-policy",
    evidence: "sha256:node-evidence",
  },
  {
    name: "Decision Dashboard",
    type: "React static runtime",
    url: reactUrl,
    owner: "Digital transformation demo",
    linkedAgent: "None yet",
    status: "Live",
    risk: "Low",
    verifier: "Sandbox basic auth",
    secrets: "No app secrets",
    policy: "sha256:react-policy",
    evidence: "sha256:react-evidence",
  },
  {
    name: "Claude + Excel Cloud PC",
    type: "AWS WorkSpaces/AppStream computer",
    url: "Session URL generated at runtime",
    owner: "Platform admin",
    linkedAgent: "Cloud PC Excel coworker",
    status: "Design track",
    risk: "High",
    verifier: "VTI step-up planned",
    secrets: "3P login preboot / gateway planned",
    policy: "pending",
    evidence: "pending",
  },
] as const;

const runtimeIcon = {
  "Streamlit runtime": Container,
  "Node.js + DynamoDB": Terminal,
  "React static runtime": Code2,
  "AWS WorkSpaces/AppStream computer": ShieldEllipsis,
} satisfies Record<(typeof governedComputers)[number]["type"], LucideIcon>;

const computerActions = [
  { label: "Open", state: "live" },
  { label: "Pause", state: "preview" },
  { label: "Kill session", state: "preview" },
  { label: "Export evidence", state: "preview" },
] as const;

const demoCommand = `# Streamlit
pnpm onecomputer:deploy examples/streamlit/meeting-tracker --runtime streamlit --execute-aws

# Node.js + simple DB
pnpm onecomputer:deploy examples/node/task-tracker --runtime node --db dynamodb --execute-aws

# React static
pnpm onecomputer:deploy examples/react/decision-dashboard --runtime react-static --execute-aws`;

const currentTruths = [
  ["Streamlit", "Live governed URL achieved"],
  ["Node.js + DB", "Live URL + DynamoDB create/read verified"],
  ["React static", "Live URL achieved; Vite build served by nginx"],
  ["Gateway", "Signed grant gateway controls origin-token app access"],
  ["Revoke", "Pause/resume/user revoke E2E verified"],
  ["CISO readiness", "85/100 demo-ready; not production"],
] as const;

const liveProofs = [
  {
    label: "Streamlit URL",
    value: "200/401/200",
    detail:
      "Health is public for ECS; app root requires auth and renders with auth.",
  },
  {
    label: "Node.js + DynamoDB",
    value: "403 + 200",
    detail:
      "Direct origin blocks without token; gateway grant reads DynamoDB-backed API.",
  },
  {
    label: "Gateway response",
    value: "pause/revoke proven",
    detail:
      "Pause returns app_paused; resume restores; revoke returns user_revoked.",
  },
] as const;

const passportFacts = [
  ["Runtime", "Streamlit / ECS Express"],
  ["Owner", "Local builder"],
  ["Linked agent", "Meeting tracker app agent"],
  ["Data class", "Internal productivity data"],
  ["Access path", "Gateway grant + origin token"],
  ["Evidence head", "sha256:streamlit-evidence"],
] as const;

const evidenceTimeline = [
  {
    title: "Source detected",
    detail: "Local Streamlit app classified as small internal app.",
    time: "T-04",
    hash: "sha256:source-scan",
    icon: FileText,
  },
  {
    title: "Image built",
    detail: "Guarded container generated and pushed through AWS build path.",
    time: "T-03",
    hash: "sha256:image-build",
    icon: PackageCheck,
  },
  {
    title: "Runtime registered",
    detail: "Gateway registry recorded owner, URL, policy, and verifier state.",
    time: "T-02",
    hash: "sha256:runtime-registry",
    icon: Server,
  },
  {
    title: "Access checked",
    detail: "Direct origin denied; gateway grant allowed controlled access.",
    time: "T-01",
    hash: "sha256:access-decision",
    icon: ShieldCheck,
  },
] as const;

const policyClaims = [
  "Origin requires token; direct runtime access is blocked.",
  "Gateway grant is scoped to Meeting Tracker and expires/revokes independently.",
  "Owner and linked agent are visible before sharing outside the builder.",
  "Runtime evidence export remains API-backed; high-exposure agent metadata export is visible in P6.3.",
] as const;

const builderLaunchpad = {
  app: "Meeting Tracker",
  runtime: "Streamlit runtime",
  owner: "Local builder",
  governedUrl,
  authState: "Gateway grant active",
  approvalState: "Team share allowed; external share needs reviewer",
  evidenceState: "Passport + access proof visible",
  nextAction: "Open governed URL or request wider access review",
} as const;

const builderStatusCards = [
  {
    label: "Governed URL",
    value: "Ready",
    detail:
      "One shareable URL is visible, with direct-origin access still blocked.",
    icon: Globe2,
  },
  {
    label: "Auth state",
    value: "Granted",
    detail:
      "Gateway grant is active; enterprise IAM/VTI remains next hardening.",
    icon: KeyRound,
  },
  {
    label: "Approval state",
    value: "Scoped",
    detail: "Local pilot sharing is okay; wider sharing routes to reviewer.",
    icon: ShieldCheck,
  },
  {
    label: "Evidence",
    value: "Visible",
    detail: "Builder sees the proof needed before asking cyber for review.",
    icon: FileText,
  },
] as const;

const builderJourneyQuestions = [
  [
    "Where is my app?",
    "The governed URL is surfaced before the registry table.",
  ],
  [
    "Can my team open it?",
    "Current grant/auth and approval state are explicit.",
  ],
  [
    "Why would access fail?",
    "Direct origin is blocked; use gateway URL and valid grant.",
  ],
  [
    "What do I do next?",
    "Open the URL, copy evidence, or request wider access review.",
  ],
] as const;

const builderSteps = [
  {
    title: "Pick local app",
    detail: "User chooses a Claude Code / Streamlit / Node / React folder.",
    status: "Done",
  },
  {
    title: "Build in AWS",
    detail: "CodeBuild builds the guarded app image and pushes to ECR.",
    status: "Done",
  },
  {
    title: "Get governed URL",
    detail: "ECS Express returns a real URL gated by sandbox basic auth.",
    status: "Done",
  },
  {
    title: "Share with team",
    detail: "Replace sandbox auth with IAM/VTI grants and expiry.",
    status: "Next",
  },
] as const;

const adminSteps = [
  {
    title: "Evidence pack",
    detail: "Owner, data class, source hash, build, deploy, and access mode.",
    status: "Current",
  },
  {
    title: "Org + roles",
    detail: "Admin, app owner, reviewer, viewer. Not local single-user only.",
    status: "Missing",
  },
  {
    title: "Review queue",
    detail: "CISO approves app access, exceptions, renewal, and expiry.",
    status: "Missing",
  },
  {
    title: "Kill switch",
    detail:
      "Pause/revoke must actually block runtime access and emit evidence.",
    status: "Missing",
  },
] as const;

const artifacts = [
  ["app-passport.json", "Owner, users, data class, runtime, source hash"],
  ["evidence-pack.json", "Detection, secret scan, CodeBuild, ECS deploy"],
  [
    "Dockerfile.onecomputer",
    "Nginx-auth guarded Streamlit / Node / React container",
  ],
  ["access-instructions.local.json", "Sandbox-only credentials, not committed"],
] as const;

const remainingGaps = [
  {
    title: "IAM/VTI access broker",
    icon: LockKeyhole,
    detail: "Replace sandbox basic auth with signed grants and enterprise IAM.",
  },
  {
    title: "App registry",
    icon: Container,
    detail: "Persist deployed apps, endpoints, owners, expiry, and evidence.",
  },
  {
    title: "Admin/CISO UX",
    icon: UserCog,
    detail: "Fleet inventory, review queue, evidence export, revoke controls.",
  },
  {
    title: "Real revoke",
    icon: ShieldCheck,
    detail: "Admin pause must block access and emit tamper-evident records.",
  },
] as const;

export const SecureAppsContent = () => {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <Card className="border-brand/30 bg-brand/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-brand">
                <ShieldCheck className="size-3" /> Computer inventory
              </Badge>
              <Badge variant="outline">Apps + sandboxes + Cloud PCs</Badge>
              <Badge variant="outline">Runtime exposure</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Runtime inventory, exposure, and enforcement state.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Track every deployed app and AI computer as a managed asset:
              access path, owner, linked agent, verifier, secrets posture,
              policy, evidence head, and response action.
            </p>
          </div>
          <div className="grid gap-2 rounded-xl border bg-background p-4 text-xs sm:grid-cols-2 lg:w-[420px]">
            <Metric label="Managed assets" value="4" />
            <Metric label="Live runtimes" value="3" />
            <Metric label="High exposure" value="1" />
            <Metric label="Mobile polish" value="P6.5" />
          </div>
        </div>
      </Card>

      <BuilderLaunchpad />

      <Card className="p-5">
        <SectionHeader
          eyebrow="Runtime registry"
          title="Computers linked to agents, policies, and evidence"
          description="The operator view starts here: what is running, who owns it, which agent can use it, what policy applies, and how to stop it."
        />
        <div className="mt-5 overflow-hidden rounded-xl border">
          <div className="grid grid-cols-[1.1fr_0.9fr_0.8fr_0.8fr_0.9fr] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground max-xl:hidden">
            <span>Computer</span>
            <span>Owner / agent</span>
            <span>Trust</span>
            <span>Evidence</span>
            <span>Actions</span>
          </div>
          <div className="divide-y">
            {governedComputers.map((computer) => (
              <ComputerRow key={computer.name} computer={computer} />
            ))}
          </div>
        </div>
      </Card>

      <RuntimePassportDetail />

      <Card className="border-brand/30 bg-brand/5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-brand">
                <CheckCircle2 className="size-3" /> Enforcement evidence
              </Badge>
              <Badge variant="outline">Controlled pilot</Badge>
              <Badge variant="outline">Not production-ready</Badge>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Current control state for governed app access.
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The pilot has origin-token protection, signed gateway grants,
              DynamoDB-backed Node hosting, access-decision audit logs, and live
              pause, resume, and user-revoke checks. The control plane is
              operationally useful, but still below enterprise production
              readiness.
            </p>
            <div className="mt-4 rounded-xl border bg-background/80 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ExternalLink className="size-3.5" /> Governed sandbox URLs
              </div>
              <div className="space-y-1 font-mono text-xs text-foreground">
                <p className="break-all">Streamlit: {governedUrl}</p>
                <p className="break-all">Node+DynamoDB: {nodeDynamoUrl}</p>
                <p className="break-all">React: {reactUrl}</p>
                <p className="break-all">
                  Origin-protected: {originProtectedUrl}
                </p>
                <p className="break-all">Access Gateway: {cisoGatewayUrl}</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-background p-4 lg:w-[390px]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Observed controls
            </p>
            <div className="mt-3 divide-y">
              {currentTruths.map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[120px_1fr] gap-3 py-2 text-xs"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="break-words font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden border-brand/20 bg-gradient-to-br from-brand/10 via-background to-background p-6 md:p-7">
          <Badge variant="secondary" className="gap-1">
            <Rocket className="size-3" /> Builder workflow
          </Badge>
          <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight">
            Local task: deploy a small app with guardrails.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            The command path handles common shadow-IT shapes: Streamlit, Node.js
            with a simple DynamoDB table, and React static dashboards. The next
            UX step is a local deploy wizard that submits the app into an admin
            review queue with expiry, owner, and data-scope metadata.
          </p>
          <div className="mt-5 rounded-xl border bg-background/75 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Terminal className="size-3.5" /> Working command path
            </div>
            <pre className="overflow-x-auto rounded-lg bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
              {demoCommand}
            </pre>
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            eyebrow="Verification"
            title="Governed URL control checks"
            description="Minimum evidence before a runtime is shown as accessible."
          />
          <div className="mt-4 space-y-3">
            {liveProofs.map((proof) => (
              <div
                key={proof.label}
                className="flex gap-3 rounded-lg border bg-muted/20 p-3"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{proof.label}</p>
                    <Badge variant="secondary">{proof.value}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {proof.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <UxLane
          title="Builder UX"
          subtitle="For the local user building small AI apps"
          icon={Code2}
          items={builderSteps}
        />
        <UxLane
          title="Admin / CISO UX"
          subtitle="For cyber, platform, and digital transformation teams"
          icon={UserCog}
          items={adminSteps}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-5">
          <SectionHeader
            eyebrow="What works today"
            title="Generated deployment artifacts"
            description="The live URL is backed by file evidence, not just dashboard copy."
          />
          <div className="mt-4 space-y-3">
            {artifacts.map(([name, detail]) => (
              <div
                key={name}
                className="flex gap-3 rounded-lg border bg-muted/20 p-3"
              >
                <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                <div>
                  <p className="font-mono text-xs font-medium">{name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionHeader
            eyebrow="Still not CISO-ready"
            title="Open control gaps"
            description="Issues that keep this in controlled-pilot status."
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {remainingGaps.map((gap) => (
              <div
                key={gap.title}
                className="rounded-lg border bg-muted/20 p-4"
              >
                <gap.icon className="size-4 text-brand" />
                <p className="mt-3 text-sm font-medium">{gap.title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {gap.detail}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <h2 className="text-lg font-semibold tracking-tight">
                Next control milestone: enterprise auth and runtime revoke
              </h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              One app is protected by an origin token and governed through the
              gateway with pause, resume, revoke, and access records. The next
              hardening step is replacing signed demo grants with enterprise
              OIDC/IAM/VTI and proving revoke across every runtime type.
            </p>
          </div>
          <div className="min-w-56">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Current readiness</span>
              <span className="font-medium">85/100</span>
            </div>
            <Progress value={85} />
          </div>
        </div>
      </Card>
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border bg-muted/20 p-3">
    <p className="text-muted-foreground">{label}</p>
    <p className="mt-1 text-lg font-semibold">{value}</p>
  </div>
);

const BuilderLaunchpad = () => (
  <Card className="overflow-hidden border-brand/30 bg-gradient-to-br from-brand/10 via-background to-background p-4 sm:p-5">
    <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 text-brand">
            <Sparkles className="size-3.5" /> Builder launchpad
          </Badge>
          <Badge variant="outline">P6.5 mobile-ready</Badge>
          <Badge variant="outline">Low cognitive load</Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
          Your app is live. Here is the governed way to open and share it.
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The builder view should answer the first four questions without making
          a user read the CISO registry: where is my app, who can open it, why
          would access fail, and what should I do next?
        </p>
        <div className="mt-4 rounded-xl border bg-background/80 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{builderLaunchpad.app}</Badge>
            <Badge variant="outline">{builderLaunchpad.runtime}</Badge>
            <Badge variant="outline">Owner: {builderLaunchpad.owner}</Badge>
          </div>
          <p className="mt-3 break-all font-mono text-xs text-foreground">
            {builderLaunchpad.governedUrl}
          </p>
          <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <Button
              size="sm"
              className="w-full justify-center sm:w-auto"
              asChild
            >
              <a
                href={builderLaunchpad.governedUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-3.5" /> Open governed URL
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center sm:w-auto"
              disabled
            >
              Request wider access
              <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center sm:w-auto"
              disabled
            >
              Copy evidence pack
              <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 2xl:w-[520px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {builderStatusCards.map((item) => (
            <div
              key={item.label}
              className="rounded-xl border bg-background/80 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <item.icon className="size-4 text-brand" />
                <Badge variant="secondary">{item.value}</Badge>
              </div>
              <p className="mt-3 text-sm font-medium">{item.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border bg-background/80 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Builder answers
          </p>
          <div className="mt-3 divide-y">
            {builderJourneyQuestions.map(([question, answer]) => (
              <div
                key={question}
                className="grid gap-1 py-2 text-xs sm:grid-cols-[140px_1fr]"
              >
                <span className="font-medium text-foreground">{question}</span>
                <span className="text-muted-foreground">{answer}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </Card>
);

const RuntimePassportDetail = () => (
  <Card className="p-5">
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 text-brand">
            <FileText className="size-3.5" />
            Runtime passport
          </Badge>
          <Badge variant="outline">Selected: Meeting Tracker</Badge>
          <Badge variant="outline">P6.3 detail view</Badge>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight">
          Evidence timeline for one governed app runtime.
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          CISO users need to understand the story behind the hashes. This detail
          view turns the Meeting Tracker runtime into a readable passport:
          owner, linked agent, access path, policy claims, and evidence events.
        </p>
      </div>
      <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-xs sm:grid-cols-2 xl:w-[460px]">
        {passportFacts.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-background/70 p-3">
            <p className="text-muted-foreground">{label}</p>
            <p className="mt-1 break-words font-medium">{value}</p>
          </div>
        ))}
      </div>
    </div>

    <div className="mt-5 grid gap-5 2xl:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-xl border bg-background/60 p-4">
        <div className="flex items-center gap-2">
          <Route className="size-4 text-brand" />
          <h3 className="text-sm font-semibold">Evidence timeline</h3>
        </div>
        <div className="mt-4 space-y-3">
          {evidenceTimeline.map((event, index) => (
            <div key={event.title} className="grid grid-cols-[32px_1fr] gap-3">
              <div className="flex flex-col items-center">
                <span className="flex size-8 items-center justify-center rounded-full border bg-muted/30">
                  <event.icon className="size-4 text-brand" />
                </span>
                {index < evidenceTimeline.length - 1 && (
                  <span className="mt-2 h-10 w-px bg-border" />
                )}
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{event.title}</p>
                  <Badge variant="outline" className="gap-1">
                    <Clock className="size-3" />
                    {event.time}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {event.detail}
                </p>
                <p className="mt-2 flex items-center gap-1.5 break-all font-mono text-[11px] text-muted-foreground">
                  <Hash className="size-3.5" />
                  {event.hash}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-brand" />
            <h3 className="text-sm font-semibold">Policy claims</h3>
          </div>
          <div className="mt-4 space-y-2">
            {policyClaims.map((claim) => (
              <div
                key={claim}
                className="flex gap-2 rounded-lg border bg-muted/20 p-3"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
                <p className="text-xs leading-5 text-muted-foreground">
                  {claim}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-brand" />
            <h3 className="text-sm font-semibold">Data and custody</h3>
          </div>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
            <MiniFact icon={UserRound} label="Owner" value="Local builder" />
            <MiniFact icon={UserCog} label="Reviewer" value="Platform admin" />
            <MiniFact
              icon={ShieldEllipsis}
              label="Verifier"
              value="VTI-ready grant"
            />
            <MiniFact
              icon={ExternalLink}
              label="Access"
              value="Gateway URL only"
            />
          </div>
        </Card>
      </div>
    </div>
  </Card>
);

const MiniFact = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) => (
  <div className="rounded-lg border bg-muted/20 p-3">
    <p className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="size-3.5" />
      {label}
    </p>
    <p className="mt-1 font-medium">{value}</p>
  </div>
);

const ComputerRow = ({
  computer,
}: {
  computer: (typeof governedComputers)[number];
}) => {
  const Icon = runtimeIcon[computer.type];

  return (
    <div className="grid gap-4 rounded-lg border bg-muted/10 px-3 py-4 sm:px-4 xl:grid-cols-[1.1fr_0.9fr_0.8fr_0.8fr_0.9fr] xl:rounded-none xl:border-0 xl:bg-transparent">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
            <Icon className="size-4 text-brand" />
          </span>
          <p className="font-medium">{computer.name}</p>
          <Badge variant="secondary">{computer.status}</Badge>
          <Badge variant="outline">{computer.risk}</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{computer.type}</p>
        <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
          {computer.url}
        </p>
      </div>
      <div className="text-sm">
        <p className="flex items-center gap-1.5">
          <UserCog className="size-3.5 text-muted-foreground" />
          {computer.owner}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Agent: {computer.linkedAgent}
        </p>
      </div>
      <div className="text-xs">
        <p className="flex items-center gap-1.5 font-medium">
          <ShieldCheck className="size-3.5 text-brand" />
          {computer.verifier}
        </p>
        <p className="mt-1 text-muted-foreground">{computer.secrets}</p>
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <FileText className="size-3.5" />
          Policy: {computer.policy}
        </p>
        <p className="mt-1">Evidence: {computer.evidence}</p>
        <div className="mt-2 flex flex-wrap gap-1.5 font-sans">
          <Badge variant="outline">Passport visible</Badge>
          <Badge variant="outline">
            {computer.evidence === "pending"
              ? "Evidence pending"
              : "Evidence head visible"}
          </Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {computerActions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            size="sm"
            className="w-full justify-start sm:w-auto"
            disabled={action.state === "preview"}
            title={
              action.state === "preview"
                ? "Live enforcement wiring remains gated behind review and audit append."
                : "Live navigation action."
            }
          >
            {action.label}
            {action.state === "preview" && (
              <span className="rounded border px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
};

const UxLane = ({
  title,
  subtitle,
  icon: Icon,
  items,
}: {
  title: string;
  subtitle: string;
  icon: typeof Code2;
  items: readonly { title: string; detail: string; status: string }[];
}) => (
  <Card className="p-5">
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-brand" />
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
    <div className="mt-5 space-y-3">
      {items.map((item, index) => (
        <div
          key={item.title}
          className="grid grid-cols-[32px_1fr] gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[32px_1fr_auto]"
        >
          <div className="flex size-7 items-center justify-center rounded-full border bg-background text-xs font-medium">
            {index + 1}
          </div>
          <div>
            <p className="text-sm font-medium">{item.title}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {item.detail}
            </p>
          </div>
          <Badge
            variant={item.status === "Missing" ? "outline" : "secondary"}
            className="col-start-2 w-fit sm:col-start-auto"
          >
            {item.status}
          </Badge>
        </div>
      ))}
    </div>
  </Card>
);

const SectionHeader = ({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) => (
  <div>
    <p className="text-xs font-medium uppercase tracking-wide text-brand">
      {eyebrow}
    </p>
    <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
  </div>
);
