/**
 * Governed-action demo trigger — drives a REAL gateway hold.
 *
 * The "Try a governed action" card (apps/web .../governed-action-card.tsx)
 * calls POST /v1/sandboxes/:id/trigger-governed-action, which delegates here.
 *
 * What this does (nothing faked):
 *   1. Resolve the agent access token (env override, else the demo-corp default
 *      agent's `accessToken` from the DB — the same token the gateway MITM
 *      resolves from the `aoc_...` proxy-auth user).
 *   2. Fire a POST to https://graph.microsoft.com/v1.0/me/sendMail THROUGH the
 *      OneComputer gateway (MITM proxy) using the agent token as proxy auth.
 *      The seeded `manual_approval` rule for that host+path matches, the
 *      gateway holds the request (apps/gateway/src/gateway/forward.rs:449-541),
 *      and persists a durable ApprovalRequest via notify_api.
 *   3. The held curl blocks up to ~180s awaiting a manager decision, so we run
 *      it detached (fire-and-forget) and instead poll the internal approvals
 *      list for the freshly-created pending hold.
 *   4. Return { approvalId, status: "pending" } so the card can poll
 *      GET /v1/approvals/:id (or /v1/internal/approvals/:id) and render the
 *      held → released transition.
 *
 * Why server-side: a browser cannot speak HTTP-CONNECT proxy auth + MITM TLS to
 * the gateway cleanly (CORS, proxy headers, CA trust). The card's prior curl
 * ran inside the sandbox with `HTTPS_PROXY` unset, so it never actually held.
 * Doing the curl server-side (where the API process can reach 127.0.0.1:10255
 * and trust the gateway's MITM CA via curl -k) makes the hold real.
 */
import { spawn } from "node:child_process";
import { db } from "@onecli/db";
import {
  GOVERNED_ACTION_AGENT_TOKEN,
  GOVERNED_ACTION_GATEWAY_URL,
} from "../lib/env";
import { getGraphToken, loadAzureCreds } from "./azure-alert-service";
import { listApprovalsByBridge } from "./approval-service";
import { ServiceError } from "./errors";

const GRAPH_URL = "https://graph.microsoft.com/v1.0/me/sendMail";
const GRAPH_APP_URL =
  "https://graph.microsoft.com/v1.0/users/mailgini@giniresearch.onmicrosoft.com/sendMail";
const GRAPH_HOST = "graph.microsoft.com";
const GRAPH_PATH = "/v1.0/me/sendMail";

// How long to wait for the gateway to register the hold before giving up.
const HOLD_POLL_TIMEOUT_MS = 8_000;
const HOLD_POLL_INTERVAL_MS = 500;

export interface TriggeredGovernedAction {
  approvalId: string;
  status: "pending";
  host: string;
  path: string;
  method: string;
}

/**
 * Resolve the agent access token to use as gateway proxy auth.
 *
 * Priority:
 *   1. GOVERNED_ACTION_AGENT_TOKEN env var (operator override).
 *   2. The demo-corp org's default agent's `accessToken` (the agent the
 *      seeded manual_approval rule belongs to). This makes the card work
 *      out-of-the-box after `pnpm seed:demo` with no extra env.
 *
 * Throws a 400-style ServiceError if no token can be resolved (e.g. demo data
 * not seeded) so the UI surfaces a clear message instead of a silent 401.
 */
const resolveAgentToken = async (): Promise<string> => {
  if (GOVERNED_ACTION_AGENT_TOKEN) return GOVERNED_ACTION_AGENT_TOKEN;

  // The demo org's project is demo-corp-team-field-sales (see scripts/seed-demo.ts).
  // Agent is scoped by projectId (not organizationId) in the Prisma schema.
  const DEMO_PROJECT_ID = "demo-corp-team-field-sales";
  const agent = await db.agent.findFirst({
    where: { projectId: DEMO_PROJECT_ID, isDefault: true },
    select: { accessToken: true, name: true },
  });
  if (agent?.accessToken) return agent.accessToken;

  // Last resort: any agent in the demo project.
  const anyAgent = await db.agent.findFirst({
    where: { projectId: DEMO_PROJECT_ID },
    select: { accessToken: true },
  });
  if (anyAgent?.accessToken) return anyAgent.accessToken;

  throw new ServiceError(
    "BAD_REQUEST",
    "No agent token configured for the governed-action trigger. Set GOVERNED_ACTION_AGENT_TOKEN or seed the demo agent (pnpm seed:demo).",
  );
};

/**
 * Fire the gateway curl detached. The held request blocks up to ~180s in the
 * gateway awaiting a decision; we don't want to block the HTTP route on that.
 * Returns immediately after spawning. Errors are swallowed to logs — the
 * follow-up approval-list poll is the source of truth for whether the hold
 * landed.
 */
const fireGatewayCurlDetached = (
  agentToken: string,
  body: string,
  targetUrl: string,
  graphToken?: string,
): void => {
  const proxyUrl = `${GOVERNED_ACTION_GATEWAY_URL}/`.replace(/\/$/, "");
  // -k: trust the gateway's MITM CA (the gateway presents a synthetic cert for
  //     graph.microsoft.com). Without -k curl rejects the TLS handshake.
  // --max-time 190: the gateway holds a manual-approval request for up to
  //     180 seconds. The client must outlive that window or a valid manager
  //     decision cannot release the upstream action. Keep a small buffer for
  //     the final gateway→Graph round trip.
  const args = [
    "-s",
    "-k",
    "-i",
    "-x",
    `http://x:${agentToken}@${proxyUrl.replace(/^https?:\/\//, "")}`,
    "-X",
    "POST",
    targetUrl,
    "-H",
    "Content-Type: application/json",
    "--config",
    "-",
    "--data-raw",
    body,
    "--max-time",
    "190",
  ];
  try {
    const child = spawn("curl", args, {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    // Keep the Graph bearer out of the process argument list. curl reads the
    // sensitive header from stdin and then closes the pipe before the hold.
    child.stdin.end(
      `header = "Authorization: Bearer ${graphToken ?? "DEMO_NO_TOKEN"}"\n`,
    );
    // Detach so the child survives the request handler returning.
    child.unref();
  } catch (err) {
    // Non-fatal: the poll below will simply find no new hold and we surface
    // a clear error to the UI.
    console.error(
      "[governed-action] failed to spawn gateway curl:",
      err instanceof Error ? err.message : String(err),
    );
  }
};

/**
 * Poll the internal approvals list for a freshly-created pending hold matching
 * the governed sendMail action. The gateway stamps `context.gatewayApprovalId`
 * on rows it creates via notify_api, so listApprovalsByBridge surfaces them.
 */
const waitForHold = async (
  sinceMs: number,
): Promise<{
  id: string;
  host: string;
  path: string;
  method: string;
} | null> => {
  const deadline = sinceMs + HOLD_POLL_TIMEOUT_MS;
  while (true) {
    const { items } = await listApprovalsByBridge({
      status: "pending",
      limit: 10,
    });
    const match = items.find((row) => {
      const ctx = (row.context ?? {}) as Record<string, unknown>;
      const vti = (ctx._vti ?? {}) as Record<string, unknown>;
      const payload = (vti.payload ?? {}) as Record<string, unknown>;
      const host = String(payload.host ?? ctx.host ?? "");
      const path = String(payload.path ?? ctx.path ?? "");
      const createdAt =
        row.createdAt instanceof Date ? row.createdAt.getTime() : 0;
      return (
        host.includes(GRAPH_HOST) &&
        path.endsWith("/sendMail") &&
        createdAt >= sinceMs - 2_000 // small clock-skew tolerance
      );
    });
    if (match) {
      const ctx = (match.context ?? {}) as Record<string, unknown>;
      const vti = (ctx._vti ?? {}) as Record<string, unknown>;
      const payload = (vti.payload ?? {}) as Record<string, unknown>;
      return {
        id: match.id,
        host: String(payload.host ?? GRAPH_HOST),
        path: String(payload.path ?? GRAPH_PATH),
        method: String(payload.method ?? "POST"),
      };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, HOLD_POLL_INTERVAL_MS));
  }
};

/**
 * Trigger a governed Outlook sendMail action through the real gateway hold.
 *
 * @returns the created ApprovalRequest id (status=pending) so the caller can
 *          poll for the manager's decision.
 */
export const triggerGovernedAction =
  async (): Promise<TriggeredGovernedAction> => {
    const agentToken = await resolveAgentToken();
    const azureCreds = await loadAzureCreds();
    const graphToken = azureCreds ? await getGraphToken(azureCreds) : undefined;
    const graphUrl = graphToken ? GRAPH_APP_URL : GRAPH_URL;

    // A unique marker in the body so we can correlate the hold we just created
    // (the gateway stores a bodyPreview in context._vti.payload.bodyPreview).
    const runId = `one73-${Math.random().toString(36).slice(2, 10)}`;
    const body = JSON.stringify({
      message: {
        subject: `OneComputer governed action ${runId}`,
        body: { contentType: "Text", content: "Governed action trigger" },
        toRecipients: [
          {
            emailAddress: {
              address: graphToken
                ? "terencetan@giniresearch.onmicrosoft.com"
                : "demo@example.com",
            },
          },
        ],
      },
      _onecomputerRunId: runId,
    });

    const firedAt = Date.now();
    fireGatewayCurlDetached(agentToken, body, graphUrl, graphToken);

    const hold = await waitForHold(firedAt);
    if (!hold) {
      throw new ServiceError(
        "INTERNAL",
        "Gateway did not produce a pending approval in time. Is the gateway running at :10255 and the manual_approval rule for graph.microsoft.com/v1.0/me/sendMail seeded?",
      );
    }

    return {
      approvalId: hold.id,
      status: "pending",
      host: hold.host,
      path: hold.path,
      method: hold.method,
    };
  };
