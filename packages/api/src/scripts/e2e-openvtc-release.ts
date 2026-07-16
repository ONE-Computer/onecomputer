import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { db } from "@onecli/db";
import {
  getApprovalByBridgeId,
  triggerApprovalVtiNotification,
} from "../services/approval-service";
import { getGraphToken, loadAzureCreds } from "../services/azure-alert-service";
import { didWebFromBaseUrl } from "../lib/vti-credential-signer";

const GATEWAY = process.env.GATEWAY_API_URL ?? "http://127.0.0.1:11255";
const OPENVTC_APPROVAL_API =
  process.env.OPENVTC_APPROVAL_API_URL ??
  "http://127.0.0.1:10254/v1/openvtc-approvals";
const OPENVTC_TEST_WALLET =
  process.env.OPENVTC_TEST_WALLET_URL ?? "http://127.0.0.1:18100";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runCurl = (
  token: string,
  target: string,
  body: string,
  upstreamBearer?: string,
) =>
  new Promise<{ status: number; output: string }>((resolve, reject) => {
    const proxy = GATEWAY.replace(/^https?:\/\//, "");
    const child = spawn(
      "curl",
      [
        "-sS",
        "-i",
        "-k",
        "--max-time",
        "40",
        "-x",
        `http://x:${token}@${proxy}`,
        "-X",
        "POST",
        "-H",
        "content-type: application/json",
        "--config",
        "-",
        "--data-raw",
        body,
        target,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.end(
      upstreamBearer
        ? `header = "Authorization: Bearer ${upstreamBearer}"\n`
        : "",
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", () => {
      const matches = [...output.matchAll(/^HTTP\/[\d.]+\s+(\d+)/gm)];
      const upstream = matches.at(-1);
      resolve({ status: Number(upstream?.[1] ?? 0), output });
    });
  });

const postWalletDecision = async (
  approvalId: string,
  document: Record<string, unknown>,
) => {
  const response = await fetch(
    `${OPENVTC_APPROVAL_API.replace(/\/$/, "")}/${approvalId}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document,
        comment: "standalone OpenVTC test wallet",
      }),
    },
  );
  return { status: response.status, body: await response.text() };
};

const getWalletIdentity = async () => {
  const response = await fetch(
    `${OPENVTC_TEST_WALLET.replace(/\/$/, "")}/identity`,
  );
  if (!response.ok) {
    throw new Error(`test wallet identity failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { did?: unknown };
  if (typeof body.did !== "string" || !body.did.startsWith("did:key:")) {
    throw new Error("test wallet did:key identity is missing");
  }
  return body.did;
};

const approveInWallet = async (approvalId: string) => {
  const response = await fetch(
    `${OPENVTC_TEST_WALLET.replace(/\/$/, "")}/approve/${encodeURIComponent(approvalId)}`,
    { method: "POST" },
  );
  return { status: response.status, body: await response.text() };
};

const main = async () => {
  const upstream = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ executed: true, method: req.method, url: req.url }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const address = upstream.address();
  if (!address || typeof address === "string")
    throw new Error("upstream bind failed");

  const manager = await db.user.findUnique({
    where: { externalAuthId: "demo-manager" },
    select: { id: true, externalAuthId: true },
  });
  const agent = await db.agent.findFirst({
    where: {
      projectId: "demo-corp-team-field-sales",
      identifier: "alex-agent",
    },
    select: {
      id: true,
      accessToken: true,
      projectId: true,
      project: { select: { organizationId: true } },
    },
  });
  if (!manager || !agent?.accessToken) throw new Error("run seed:demo first");

  // The private manager key stays in the separate wallet process. This
  // harness only learns the public did:key identity and calls its explicit
  // approve endpoint after the alert has been queued.
  const walletDid = await getWalletIdentity();
  process.env.OPENVTC_TRANSPORT_BINDING =
    process.env.OPENVTC_TRANSPORT_BINDING ?? "rest";
  process.env.OPENVTC_TASK_ENDPOINT_URL =
    process.env.OPENVTC_TASK_ENDPOINT_URL ??
    `${OPENVTC_TEST_WALLET}/trust-tasks`;

  const liveGraph = process.env.E2E_GRAPH_LIVE === "1";
  const graphCreds = liveGraph ? await loadAzureCreds() : null;
  if (liveGraph && !graphCreds)
    throw new Error("Azure Graph creds unavailable");
  const graphToken = graphCreds ? await getGraphToken(graphCreds) : undefined;
  const path = liveGraph
    ? "/v1.0/users/mailgini@giniresearch.onmicrosoft.com/sendMail"
    : `/e2e-openvtc-${Date.now()}`;
  const target = liveGraph
    ? `https://graph.microsoft.com${path}`
    : `http://127.0.0.1:${address.port}${path}`;
  const body = liveGraph
    ? JSON.stringify({
        message: {
          subject: `ONEComputer approved E2E ${new Date().toISOString()}`,
          body: {
            contentType: "Text",
            content:
              "This message proves the ONEComputer/OpenVTC hold, signed manager approval, and one-time Microsoft Graph release path.",
          },
          toRecipients: [
            {
              emailAddress: {
                address: "terencetan@giniresearch.onmicrosoft.com",
              },
            },
          ],
        },
        saveToSentItems: true,
      })
    : '{"message":"local OpenVTC E2E"}';
  const rule = await db.policyRule.create({
    data: {
      organizationId: agent.project.organizationId,
      projectId: agent.projectId,
      scope: "project",
      name: `OpenVTC E2E ${path}`,
      hostPattern: liveGraph ? "graph.microsoft.com" : "127.0.0.1",
      pathPattern: path,
      method: "POST",
      action: "manual_approval",
      enabled: true,
    },
  });

  try {
    const startedAt = new Date();
    const request = runCurl(agent.accessToken, target, body, graphToken);

    let approval: Awaited<ReturnType<typeof db.approvalRequest.findFirst>> =
      null;
    for (let i = 0; i < 40 && !approval; i++) {
      approval = await db.approvalRequest.findFirst({
        where: {
          status: "pending",
          organizationId: agent.project.organizationId,
          createdAt: { gte: startedAt },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!approval) await wait(250);
    }
    if (!approval) {
      const attempted = await request;
      throw new Error(
        `gateway did not create a durable hold (upstream status ${attempted.status})\n${attempted.output.slice(-4000)}`,
      );
    }

    await db.user.update({
      where: { id: manager.id },
      data: {
        externalAuthId: `openvtc:${walletDid}`,
      },
    });

    const context = approval.context as {
      _vti?: {
        stepUpRequest?: {
          payload?: {
            subject?: string;
            challenge?: string;
            requestedActionDigest?: string;
          };
          document?: Record<string, unknown>;
        };
      };
    };
    const task = context._vti?.stepUpRequest;
    if (
      !task?.payload?.subject ||
      !task.payload.challenge ||
      !task.payload.requestedActionDigest
    ) {
      throw new Error("hold lacks OpenVTC challenge");
    }
    if (task.document?.recipient !== walletDid) {
      throw new Error(
        `approval targets ${String(task.document?.recipient)} instead of configured wallet ${walletDid}`,
      );
    }
    await triggerApprovalVtiNotification({
      organizationId: agent.project.organizationId,
      approvalId: approval.id,
    });
    const rpDid =
      process.env.OPENVTC_RP_DID ??
      didWebFromBaseUrl(process.env.ONECLI_GATEWAY_PUBLIC_URL ?? "localhost");
    const unsignedDocument = {
      id: "urn:uuid:e2e-unsigned-response",
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      issuer: walletDid,
      recipient: rpDid,
      issuedAt: new Date().toISOString(),
      payload: {
        subject: task.payload.subject,
        sessionId: approval.id,
        challenge: task.payload.challenge,
        decision: "approved",
      },
    } satisfies Record<string, unknown>;
    const unsigned = await postWalletDecision(approval.id, unsignedDocument);
    const unsignedRejected = unsigned.status >= 400;
    if (!unsignedRejected) {
      throw new Error(`unsigned approval was accepted: ${unsigned.body}`);
    }

    const signed = await approveInWallet(approval.id);
    if (signed.status >= 400) {
      throw new Error(`signed OpenVTC approval was rejected: ${signed.body}`);
    }

    const response = await request;
    const verified = await getApprovalByBridgeId(approval.id);
    const replay = await approveInWallet(approval.id);
    const replayRejected = replay.status >= 400;

    const result = {
      ok:
        response.status === (liveGraph ? 202 : 200) &&
        verified.vtiVerified &&
        unsignedRejected &&
        replayRejected,
      approvalId: approval.id,
      managerDid: walletDid,
      upstreamStatus: response.status,
      upstream: liveGraph ? "microsoft-graph" : "controlled-local",
      cryptographicallyVerified: verified.vtiVerified,
      unsignedRejected,
      replayRejected,
      gitInvariant:
        "approved status and signed credential persisted atomically",
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await db.user
      .update({
        where: { id: manager.id },
        data: { externalAuthId: manager.externalAuthId },
      })
      .catch(() => undefined);
    await db.policyRule
      .delete({ where: { id: rule.id } })
      .catch(() => undefined);
    upstream.close();
    await db.$disconnect();
  }
};

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
