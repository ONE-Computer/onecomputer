import { readFile } from "node:fs/promises";
import { logger } from "../lib/logger";

// ─── Azure Graph manager-alert email (ONE-148) ───────────────────────────────
//
// When an approval is created (a hold fires), the manager who must approve it
// is notified by email via Microsoft Graph `Mail.Send`. This is a best-effort
// side-effect: a Graph failure must NEVER break the approval-creation flow
// (callers wrap in try/catch). Creds are read from
// `/etc/onecomputer/azure-env` (present on the deploy VM) and fall back to the
// process env vars of the same name.

const AZURE_ENV_FILE = "/etc/onecomputer/azure-env";

const GRAPH_TOKEN_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const GRAPH_SENDMAIL_URL =
  "https://graph.microsoft.com/v1.0/users/mailgini@giniresearch.onmicrosoft.com/sendMail";

const SENDER = "mailgini@giniresearch.onmicrosoft.com";
const RECIPIENT = "terencetan@giniresearch.onmicrosoft.com";

const PUBLIC_WEB_ORIGIN =
  process.env.PUBLIC_WEB_ORIGIN ?? "http://127.0.0.1:10254";

interface AzureCreds {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/**
 * Read Azure client-credentials from `/etc/onecomputer/azure-env`, falling back
 * to the `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_TENANT_ID` env
 * vars. Returns `null` when creds are unavailable (e.g. local dev without the
 * env file) so callers can no-op cleanly.
 */
export const loadAzureCreds = async (): Promise<AzureCreds | null> => {
  const fromEnv = (): AzureCreds | null => {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;
    if (clientId && clientSecret && tenantId) {
      return { clientId, clientSecret, tenantId };
    }
    return null;
  };

  // Env vars win (deployed containers inject them directly).
  const envCreds = fromEnv();
  if (envCreds) return envCreds;

  // Then the on-VM env file.
  try {
    const text = await readFile(AZURE_ENV_FILE, "utf8");
    const parsed: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    const clientId = parsed.AZURE_CLIENT_ID;
    const clientSecret = parsed.AZURE_CLIENT_SECRET;
    const tenantId = parsed.AZURE_TENANT_ID ?? parsed.AZURE_TENANT;
    if (clientId && clientSecret && tenantId) {
      return { clientId, clientSecret, tenantId };
    }
  } catch (err) {
    logger.debug({ err }, "azure-alert: could not read azure-env file");
  }

  return null;
};

/**
 * Acquire a Graph app-only access token via the client-credentials flow.
 * Returns the bearer token or throws on failure.
 */
export const getGraphToken = async (creds: AzureCreds): Promise<string> => {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(GRAPH_TOKEN_URL(creds.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    throw new Error(
      `graph token failed: ${res.status} ${json.error ?? ""} ${
        json.error_description ?? ""
      }`.trim(),
    );
  }

  return json.access_token;
};

/**
 * Send the manager-alert email for a newly-created approval.
 *
 * @param approvalId   The ApprovalRequest id.
 * @param triggeredBy  Who/what triggered the held action (userId or label).
 * @param action       The action being approved (the "what").
 *
 * Best-effort: logs `email sent` on success or `email failed` on failure and
 * never throws. Safe to call from the approval-creation path without a
 * try/catch wrapper (though callers wrap anyway for defense-in-depth).
 */
export const sendManagerAlertEmail = async (
  approvalId: string,
  triggeredBy: string,
  action: string,
): Promise<void> => {
  try {
    const creds = await loadAzureCreds();
    if (!creds) {
      logger.warn(
        { approvalId },
        "email failed: azure creds unavailable (no env file or vars)",
      );
      return;
    }

    const token = await getGraphToken(creds);

    const approvalLink = `${PUBLIC_WEB_ORIGIN}/approvals/${approvalId}`;
    const subject = "ONEComputer: Approval required";
    const content = [
      `An action requires your approval.`,
      ``,
      `Who:  ${triggeredBy}`,
      `What: ${action}`,
      `Approval ID: ${approvalId}`,
      ``,
      `Review and decide here:`,
      `${approvalLink}`,
      ``,
      `— ONEComputer`,
    ].join("\n");

    const payload = {
      message: {
        subject,
        body: { contentType: "Text", content },
        from: { emailAddress: { address: SENDER } },
        toRecipients: [{ emailAddress: { address: RECIPIENT } }],
      },
      saveToSentItems: false,
    };

    const res = await fetch(GRAPH_SENDMAIL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`sendMail ${res.status}: ${text.slice(0, 200)}`);
    }

    logger.info(
      { approvalId, triggeredBy, action, to: RECIPIENT },
      "email sent: manager approval alert",
    );
    // Synchronous marker so the alert is unmissable in the dev log (pino-pretty
    // runs in a worker thread whose async flush can be lossy under dev).
    console.log(
      `[ONE-148] email sent: manager approval alert approvalId=${approvalId} to=${RECIPIENT}`,
    );
  } catch (err) {
    logger.error(
      { err, approvalId, triggeredBy, action },
      "email failed: manager approval alert",
    );
    console.error(
      `[ONE-148] email failed: manager approval alert approvalId=${approvalId}:`,
      err instanceof Error ? err.message : err,
    );
  }
};
