/**
 * OpenVTC approval-task transport boundary.
 *
 * ONEComputer owns the approval request and RP-side correlation. It does not
 * own wallet keys, push tokens, mediator state, or a custom notification
 * protocol. The production adapter must queue the canonical Trust Task with
 * an OpenVTC-aware VTA/mediator endpoint; the vti-push-gateway is only a
 * contentless wake doorbell and must not receive the business task directly.
 *
 * TSP is the preferred production binding, followed by DIDComm. This module
 * deliberately fails closed until an implementation for the selected binding
 * is configured. The HTTPS adapter is an explicit contract-test seam only and
 * is never selected implicitly in OpenVTC mode.
 */

export type VtiTransportAdapter =
  | "vti-outbox-local"
  | "openvtc-task-endpoint-rest"
  | "openvtc-didcomm-bridge";

export type VtiTransportReceipt = {
  adapter: VtiTransportAdapter;
  receiptId: string;
  queuedAt: string;
};

const configuredBinding = () =>
  process.env.OPENVTC_TRANSPORT_BINDING ??
  (process.env.AUTH_MODE === "openvtc" ? "tsp" : "local");

const taskEndpoint = () => process.env.OPENVTC_TASK_ENDPOINT_URL;

/**
 * Queue a canonical manager Trust Task.
 *
 * The REST contract is intentionally generic and must terminate at a VTA or
 * mediator adapter—not at `vti-push-gateway`. Its request body contains the
 * signed task and correlation id; push-provider payloads remain contentless.
 */
export const dispatchApprovalTrustTask = async (input: {
  approvalId: string;
  document: Record<string, unknown>;
}): Promise<VtiTransportReceipt> => {
  const binding = configuredBinding();
  if (binding === "local") {
    if (process.env.AUTH_MODE === "openvtc") {
      throw new Error("local VTI delivery is forbidden when AUTH_MODE=openvtc");
    }
    return {
      adapter: "vti-outbox-local",
      receiptId: `local:${input.approvalId}`,
      queuedAt: new Date().toISOString(),
    };
  }

  if (binding === "didcomm") {
    const endpoint = taskEndpoint();
    if (!endpoint) {
      throw new Error(
        "OPENVTC_TASK_ENDPOINT_URL is required for the OpenVTC DIDComm bridge",
      );
    }
    if (
      !endpoint.startsWith("http://127.0.0.1:") &&
      !endpoint.startsWith("http://localhost:")
    ) {
      throw new Error(
        "OpenVTC DIDComm bridge endpoint must be loopback-only; do not expose the wallet adapter over the network",
      );
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `onecomputer-approval:${input.approvalId}`,
      },
      body: JSON.stringify({
        protocol: "openvtc-trust-task-didcomm",
        version: "1.0",
        approvalId: input.approvalId,
        document: input.document,
        push: { contentless: true },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `OpenVTC DIDComm bridge rejected approval ${input.approvalId}: HTTP ${response.status}`,
      );
    }
    const body = (await response.json().catch(() => ({}))) as {
      receiptId?: unknown;
    };
    return {
      adapter: "openvtc-didcomm-bridge",
      receiptId:
        typeof body.receiptId === "string"
          ? body.receiptId
          : `didcomm:${input.approvalId}`,
      queuedAt: new Date().toISOString(),
    };
  }

  if (binding !== "rest") {
    throw new Error(
      `OpenVTC ${binding} transport is not configured yet; TSP is preferred, DIDComm is the fallback, and local delivery is forbidden in OpenVTC mode`,
    );
  }

  const endpoint = taskEndpoint();
  if (!endpoint) {
    throw new Error(
      "OPENVTC_TASK_ENDPOINT_URL is required for the explicit REST contract-test adapter",
    );
  }
  if (
    process.env.AUTH_MODE === "openvtc" &&
    !endpoint.startsWith("https://") &&
    process.env.ONECOMPUTER_ENV !== "local" &&
    process.env.ONECOMPUTER_ENV !== "dev"
  ) {
    throw new Error(
      "OpenVTC task endpoint must use HTTPS outside local/dev environments",
    );
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.OPENVTC_TASK_ENDPOINT_BEARER
        ? {
            authorization: `Bearer ${process.env.OPENVTC_TASK_ENDPOINT_BEARER}`,
          }
        : {}),
      "idempotency-key": `onecomputer-approval:${input.approvalId}`,
    },
    body: JSON.stringify({
      protocol: "openvtc-trust-task-queue",
      version: "0.1",
      approvalId: input.approvalId,
      document: input.document,
      push: { contentless: true },
    }),
  });
  if (!response.ok) {
    throw new Error(
      `OpenVTC task endpoint rejected approval ${input.approvalId}: HTTP ${response.status}`,
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    receiptId?: unknown;
  };
  return {
    adapter: "openvtc-task-endpoint-rest",
    receiptId:
      typeof body.receiptId === "string"
        ? body.receiptId
        : `rest:${input.approvalId}`,
    queuedAt: new Date().toISOString(),
  };
};
