import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { db } from "@onecli/db";
import {
  getApprovalByBridgeId,
  triggerApprovalVtiNotification,
} from "../services/approval-service";
import { getGraphToken, loadAzureCreds } from "../services/azure-alert-service";

const GATEWAY = process.env.GATEWAY_API_URL ?? "http://127.0.0.1:10255";
const APPROVAL_API =
  process.env.OPENVTC_APPROVAL_API_URL ??
  "http://127.0.0.1:10254/v1/openvtc-approvals";
const MANAGER_DID = process.env.OPENVTC_APPROVER_DID;
const PENDING_DIR =
  process.env.OPENVTC_WALLET_PENDING_DIR ?? "/var/lib/openvtc/wallet/pending";
const WALLET_SCRIPT =
  process.env.OPENVTC_WALLET_SCRIPT ??
  "/usr/local/lib/openvtc/openvtc-wallet.mjs";

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
      resolve({ status: Number(matches.at(-1)?.[1] ?? 0), output });
    });
  });

const postWalletDecision = async (
  approvalId: string,
  document: Record<string, unknown>,
) => {
  const response = await fetch(
    `${APPROVAL_API.replace(/\/$/, "")}/${approvalId}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document, comment: "OpenVTC DIDComm wallet E2E" }),
    },
  );
  return { status: response.status, body: await response.text() };
};

const waitForPendingWalletRecord = async (approvalId: string) => {
  const path = `${PENDING_DIR}/${approvalId}.json`;
  for (let i = 0; i < 60; i++) {
    try {
      await access(path, constants.R_OK);
      return {
        path,
        record: JSON.parse(await readFile(path, "utf8")) as Record<string, any>,
      };
    } catch {
      await wait(250);
    }
  }
  throw new Error(`wallet did not receive DIDComm task ${approvalId}`);
};

const runWalletApprove = (approvalId: string) =>
  new Promise<{ status: number; output: string }>((resolve, reject) => {
    const command = [
      "set -a",
      "source /etc/openvtc/wallet.env",
      "set +a",
      `exec runuser -u azureuser -- /opt/node22/bin/node ${WALLET_SCRIPT} approve ${JSON.stringify(approvalId)}`,
    ].join("; ");
    const child = spawn("sudo", ["bash", "-c", command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1, output }));
  });

const main = async () => {
  if (!MANAGER_DID?.startsWith("did:peer:2.")) {
    throw new Error(
      "OPENVTC_APPROVER_DID must be the deployed did:peer:2 manager wallet",
    );
  }

  // The harness selects the real adapter in the same process that creates the
  // durable hold. The web service carries the same values in its systemd
  // drop-in for production requests.
  process.env.OPENVTC_TRANSPORT_BINDING = "didcomm";
  process.env.OPENVTC_TASK_ENDPOINT_URL = "http://127.0.0.1:18130/tasks";

  const liveGraph = process.env.E2E_GRAPH_LIVE === "1";
  const graphCreds = liveGraph ? await loadAzureCreds() : null;
  if (liveGraph && !graphCreds)
    throw new Error("Azure Graph creds unavailable");
  const graphToken = graphCreds ? await getGraphToken(graphCreds) : undefined;

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
    where: { externalAuthId: `openvtc:${MANAGER_DID}` },
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
  if (!manager || !agent?.accessToken)
    throw new Error("manager or demo agent is not provisioned");

  const path = liveGraph
    ? "/v1.0/users/mailgini@giniresearch.onmicrosoft.com/sendMail"
    : `/e2e-openvtc-didcomm-${Date.now()}`;
  const target = liveGraph
    ? `https://graph.microsoft.com${path}`
    : `http://127.0.0.1:${address.port}${path}`;
  const body = liveGraph
    ? JSON.stringify({
        message: {
          subject: `ONEComputer OpenVTC DIDComm E2E ${new Date().toISOString()}`,
          body: {
            contentType: "Text",
            content:
              "This message proves the Azure hold, OpenVTC DIDComm wallet alert, signed manager approval, and one-time Graph release.",
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
    : '{"message":"local OpenVTC DIDComm E2E"}';

  const rule = await db.policyRule.create({
    data: {
      organizationId: agent.project.organizationId,
      projectId: agent.projectId,
      scope: "project",
      name: `OpenVTC DIDComm E2E ${path}`,
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
    for (let i = 0; i < 60 && !approval; i++) {
      const candidate = await db.approvalRequest.findFirst({
        where: {
          status: "pending",
          organizationId: agent.project.organizationId,
          createdAt: { gte: startedAt },
        },
        orderBy: { createdAt: "desc" },
      });
      const candidateContext = candidate?.context as {
        _vti?: {
          stepUpRequest?: {
            payload?: Record<string, any>;
            document?: Record<string, any>;
          };
        };
      } | null;
      if (
        candidate &&
        candidateContext?._vti?.stepUpRequest?.payload?.challenge &&
        candidateContext._vti.stepUpRequest.document
      ) {
        approval = candidate;
      } else {
        await wait(250);
      }
    }
    if (!approval)
      throw new Error(
        `gateway did not create durable hold: ${(await request).output.slice(-2000)}`,
      );

    const context = approval.context as {
      _vti?: {
        stepUpRequest?: {
          payload?: Record<string, any>;
          document?: Record<string, any>;
        };
      };
    };
    const task = context._vti?.stepUpRequest;
    if (!task?.payload?.subject || !task.payload.challenge || !task.document)
      throw new Error("hold lacks OpenVTC challenge/document");
    if (task.document.recipient !== MANAGER_DID)
      throw new Error("hold recipient does not match deployed manager wallet");

    await triggerApprovalVtiNotification({
      organizationId: agent.project.organizationId,
      approvalId: approval.id,
    });
    const pending = await waitForPendingWalletRecord(approval.id);
    const unsigned = { ...task.document };
    delete unsigned.proof;
    const unsignedResult = await postWalletDecision(approval.id, {
      ...unsigned,
      id: "urn:uuid:e2e-unsigned-response",
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      issuer: MANAGER_DID,
      recipient: task.document.issuer,
      payload: {
        subject: task.payload.subject,
        sessionId: approval.id,
        challenge: task.payload.challenge,
        decision: "approved",
      },
    });
    if (unsignedResult.status < 400)
      throw new Error(`unsigned response accepted: ${unsignedResult.body}`);

    const walletResult = await runWalletApprove(approval.id);
    if (walletResult.status !== 0)
      throw new Error(`wallet approve failed: ${walletResult.output}`);
    const response = await request;
    const verified = await getApprovalByBridgeId(approval.id);
    const completed = JSON.parse(
      await readFile(pending.path, "utf8"),
    ) as Record<string, any>;
    const replay = await postWalletDecision(approval.id, completed.response);

    const result = {
      ok:
        response.status === (liveGraph ? 202 : 200) &&
        verified.vtiVerified &&
        unsignedResult.status >= 400 &&
        replay.status >= 400,
      approvalId: approval.id,
      managerDid: MANAGER_DID,
      walletTaskReceived: true,
      upstream: liveGraph ? "microsoft-graph" : "controlled-local",
      upstreamStatus: response.status,
      cryptographicallyVerified: verified.vtiVerified,
      unsignedRejected: unsignedResult.status >= 400,
      replayRejected: replay.status >= 400,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await db.policyRule
      .delete({ where: { id: rule.id } })
      .catch(() => undefined);
    upstream.close();
    await db.$disconnect();
  }
};

void main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
