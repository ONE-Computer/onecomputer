/**
 * Standalone OpenVTC wallet fixture for the Azure acceptance gate.
 *
 * This process is deliberately outside the ONEComputer web/API process. It
 * owns the manager signing seed in memory, receives the canonical
 * auth/step-up/approve-request/0.1 task through the explicit REST contract
 * seam, logs an alert, and signs only after an explicit /approve/:id call.
 *
 * It is a test wallet, not production VTA/mobile delivery. Production must
 * replace this process with the OpenVTC VTA + mediator + wallet stack while
 * preserving the same canonical Trust-Task and external ingress boundary.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import {
  didKeyFromPublicKey,
  didWebFromBaseUrl,
  signTrustTask,
  signingKeyFromSeed,
} from "../lib/vti-credential-signer";

const HOST = process.env.OPENVTC_TEST_WALLET_HOST ?? "127.0.0.1";
const PORT = Number(process.env.OPENVTC_TEST_WALLET_PORT ?? "18100");
const API_BASE =
  process.env.OPENVTC_APPROVAL_API_URL ??
  "http://127.0.0.1:10254/v1/openvtc-approvals";
const RP_DID =
  process.env.OPENVTC_RP_DID ??
  didWebFromBaseUrl(process.env.ONECLI_GATEWAY_PUBLIC_URL ?? "localhost");

const configuredSeed = process.env.OPENVTC_TEST_WALLET_SEED
  ? process.env.OPENVTC_TEST_WALLET_SEED
  : process.env.OPENVTC_TEST_WALLET_SEED_FILE
    ? readFileSync(process.env.OPENVTC_TEST_WALLET_SEED_FILE, "utf8").trim()
    : undefined;
const seed = configuredSeed
  ? new Uint8Array(Buffer.from(configuredSeed, "base64"))
  : ed.utils.randomSecretKey();
if (seed.length !== 32) throw new Error("test wallet seed must be 32 bytes");

const identity = didKeyFromPublicKey(ed.getPublicKey(seed));
const signing = signingKeyFromSeed(
  seed,
  identity.did,
  identity.verificationMethodId,
);

type Task = {
  approvalId: string;
  document: Record<string, unknown>;
  receivedAt: string;
};

const tasks = new Map<string, Task>();

const readJson = async (request: NodeJS.ReadableStream) => {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body) as Record<string, unknown>;
};

const respond = (
  response: import("node:http").ServerResponse,
  status: number,
  body: Record<string, unknown>,
) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const approve = async (task: Task) => {
  const requestPayload = task.document.payload;
  if (
    !requestPayload ||
    typeof requestPayload !== "object" ||
    Array.isArray(requestPayload)
  ) {
    throw new Error("OpenVTC approve-request has no object payload");
  }
  const request = requestPayload as Record<string, unknown>;
  const responseDocument = await signTrustTask(
    {
      id: `urn:uuid:${randomUUID()}`,
      type: "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
      issuer: identity.did,
      recipient: RP_DID,
      issuedAt: new Date().toISOString(),
      payload: {
        subject: request.subject,
        sessionId: request.sessionId,
        challenge: request.challenge,
        decision: "approved",
        grantedAcr: "aal2",
      },
    },
    signing,
  );
  const upstream = await fetch(
    `${API_BASE.replace(/\/$/, "")}/${encodeURIComponent(task.approvalId)}/decide`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        document: responseDocument,
        comment: "approved in standalone OpenVTC test wallet",
      }),
    },
  );
  return {
    status: upstream.status,
    body: await upstream.text(),
    document: responseDocument,
  };
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return respond(response, 200, { status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/identity") {
      return respond(response, 200, {
        did: identity.did,
        verificationMethodId: identity.verificationMethodId,
      });
    }
    if (request.method === "GET" && url.pathname === "/tasks") {
      return respond(response, 200, {
        tasks: [...tasks.values()].map(({ document, ...task }) => ({
          ...task,
          taskId: document.id,
          type: document.type,
        })),
      });
    }
    if (request.method === "POST" && url.pathname === "/trust-tasks") {
      const body = await readJson(request);
      const document = body.document;
      const approvalId = body.approvalId;
      if (
        !document ||
        typeof document !== "object" ||
        Array.isArray(document) ||
        typeof approvalId !== "string"
      ) {
        return respond(response, 400, {
          error: "document and approvalId required",
        });
      }
      const task: Task = {
        approvalId,
        document: document as Record<string, unknown>,
        receivedAt: new Date().toISOString(),
      };
      tasks.set(approvalId, task);
      console.log(
        JSON.stringify({
          event: "openvtc_wallet_alert",
          approvalId,
          taskId: task.document.id,
          taskType: task.document.type,
          recipient: task.document.recipient,
          contentlessPush: Boolean(
            (body.push as { contentless?: unknown } | undefined)?.contentless,
          ),
        }),
      );
      return respond(response, 202, {
        queued: true,
        receiptId: `test-wallet:${approvalId}`,
      });
    }
    const approveMatch = url.pathname.match(/^\/approve\/([^/]+)$/);
    if (request.method === "POST" && approveMatch) {
      const approvalId = decodeURIComponent(approveMatch[1]!);
      const task = tasks.get(approvalId);
      if (!task) return respond(response, 404, { error: "task not found" });
      const result = await approve(task);
      console.log(
        JSON.stringify({
          event: "openvtc_wallet_decision_submitted",
          approvalId,
          upstreamStatus: result.status,
        }),
      );
      return respond(response, result.status, {
        status: result.status,
        body: result.body,
      });
    }
    return respond(response, 404, { error: "not found" });
  } catch (error) {
    return respond(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(
    JSON.stringify({
      event: "openvtc_test_wallet_started",
      host: HOST,
      port: PORT,
      did: identity.did,
      recipient: RP_DID,
    }),
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
