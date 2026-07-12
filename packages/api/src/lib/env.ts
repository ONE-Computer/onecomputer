/**
 * Centralized environment variable access for the API package.
 *
 * Reads both `X` and `NEXT_PUBLIC_X` variants so this works in both
 * Next.js (where build-time NEXT_PUBLIC_ prefix is required) and
 * standalone Node.js (where plain env vars are used).
 */

// ── App URLs ────────────────────────────────────────────────────────────

export const APP_URL =
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:10254";

export const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:10255";

export const GATEWAY_API_URL =
  process.env.GATEWAY_API_URL ??
  process.env.NEXT_PUBLIC_GATEWAY_API_URL ??
  "http://localhost:10255";

export const GATEWAY_BASE_URL =
  process.env.GATEWAY_BASE_URL ?? "host.docker.internal:10255";

// ── Edition ─────────────────────────────────────────────────────────────

export const EDITION =
  process.env.EDITION ?? process.env.NEXT_PUBLIC_EDITION ?? "";

export const IS_CLOUD = EDITION === "cloud";

// ── Auth & Encryption ───────────────────────────────────────────────────

export const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "";

export const SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? "";

/** Shared secret the gateway presents to the internal `/v1/internal/*` endpoints. */
export const GATEWAY_INTERNAL_SECRET =
  process.env.GATEWAY_INTERNAL_SECRET ?? "";

export const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET ?? "";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";

export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

// ── Cloud: Cognito ──────────────────────────────────────────────────────

export const COGNITO_CLIENT_ID =
  process.env.COGNITO_CLIENT_ID ??
  process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ??
  "";

export const COGNITO_DOMAIN =
  process.env.COGNITO_DOMAIN ?? process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";

export const COGNITO_USER_POOL_ID =
  process.env.COGNITO_USER_POOL_ID ??
  process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ??
  "";

// ── Cloud: Stripe ───────────────────────────────────────────────────────

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";

export const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";

// ── Cloud: Notifications ────────────────────────────────────────────────

export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

export const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

export const ENVIRONMENT = process.env.ENVIRONMENT ?? "dev";

// ── Cloud: KMS ──────────────────────────────────────────────────────────

export const KMS_KEY_ARN = process.env.KMS_KEY_ARN ?? "";

// ── Cloud: Redis ────────────────────────────────────────────────────────

export const REDIS_HOST = process.env.REDIS_HOST ?? "";

export const REDIS_PORT = process.env.REDIS_PORT ?? "6379";

export const REDIS_USERNAME = process.env.REDIS_USERNAME ?? "";

export const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? "";

// ── Gateway TLS ─────────────────────────────────────────────────────────

export const GATEWAY_CA_CERT = process.env.GATEWAY_CA_CERT ?? "";

export const GATEWAY_CA_PEM_FILE = process.env.GATEWAY_CA_PEM_FILE ?? "";

// ── Governed-action demo trigger ────────────────────────────────────────
// The "Try a governed action" card (apps/web .../governed-action-card.tsx)
// drives a REAL gateway hold: POST /v1/sandboxes/:id/trigger-governed-action
// fires a curl through the OneComputer gateway (MITM) to
// graph.microsoft.com/v1.0/me/sendMail with the agent's access token, which
// matches the seeded manual_approval rule and produces a real ApprovalRequest.
// These two vars configure that server-side curl:
//   - GOVERNED_ACTION_GATEWAY_URL: the gateway's HTTP proxy address as seen
//     from the API process (default http://127.0.0.1:10255 on this VM).
//   - GOVERNED_ACTION_AGENT_TOKEN: the demo agent's `aoc_...` access token
//     (proxy auth). If unset, the trigger route falls back to looking up the
//     default demo-corp agent's accessToken from the DB so the card works
//     out-of-the-box after `pnpm seed:demo`.
export const GOVERNED_ACTION_GATEWAY_URL =
  process.env.GOVERNED_ACTION_GATEWAY_URL ?? "http://127.0.0.1:10255";

export const GOVERNED_ACTION_AGENT_TOKEN =
  process.env.GOVERNED_ACTION_AGENT_TOKEN ?? "";

// ── Logging & Runtime ───────────────────────────────────────────────────

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const NODE_ENV = process.env.NODE_ENV ?? "development";

export const NEXT_RUNTIME = process.env.NEXT_RUNTIME ?? "";

export const HOME = process.env.HOME ?? "";

// ── Demo mode ───────────────────────────────────────────────────────────

/**
 * Explicit opt-in for demo-only surfaces (e.g. POST /v1/internal/demo/reset).
 * Defaults to enabled outside of cloud/production so local/self-hosted demo
 * environments work without extra config, but can always be forced off with
 * DEMO_MODE=0 even in a non-cloud, non-production environment.
 */
export const DEMO_MODE_ENABLED =
  process.env.DEMO_MODE === "0"
    ? false
    : process.env.DEMO_MODE === "1"
      ? true
      : EDITION !== "cloud" && NODE_ENV !== "production";
