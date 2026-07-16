/**
 * Centralized environment variable access.
 *
 * All `process.env` reads should go through this file so that defaults,
 * fallbacks, and naming are managed in one place. Import from `@/lib/env`
 * instead of reading `process.env` directly.
 *
 * NEXT_PUBLIC_* vars are inlined at build time by Next.js — they work on
 * both client and server as long as the literal string appears in source.
 */

// ── App URLs ────────────────────────────────────────────────────────────

/** Web app base URL (e.g., `https://app.onecli.sh` or `http://localhost:10254`). */
export const APP_URL =
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:10254";

/** API server URL used by browser-side code for general API calls. */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:10255";

/** Gateway HTTP API URL for vault, cache, and approval calls. */
export const GATEWAY_API_URL =
  process.env.GATEWAY_API_URL ??
  process.env.NEXT_PUBLIC_GATEWAY_API_URL ??
  "http://localhost:10255";

/**
 * Gateway CONNECT proxy address used by server-side code when the web app
 * calls the gateway from within a Docker network (e.g., `host.docker.internal:10255`).
 */
export const GATEWAY_BASE_URL =
  process.env.GATEWAY_BASE_URL ?? "host.docker.internal:10255";

// ── Edition ─────────────────────────────────────────────────────────────

/** Build-time edition: `"cloud"` or `""` (OSS). */
export const EDITION = process.env.NEXT_PUBLIC_EDITION ?? "";

/** Convenience flag for cloud-specific logic. */
export const IS_CLOUD = EDITION === "cloud";

// ── Auth & Encryption ───────────────────────────────────────────────────

export const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ?? "";
export const AUTH_MODE = process.env.AUTH_MODE ?? "";
export const ONECOMPUTER_E2E_DEMO_AUTH =
  process.env.ONECOMPUTER_E2E_DEMO_AUTH === "1";

/** OpenVTC relying-party DID. This is the exact SIOPv2 id_token audience. */
export const OPENVTC_RP_DID =
  process.env.OPENVTC_RP_DID ?? process.env.NEXT_PUBLIC_OPENVTC_RP_DID ?? "";

/**
 * Dedicated HMAC key for ONEComputer's post-verification browser session.
 * This is deliberately separate from the wallet key and must never be sent
 * to the browser.
 */
export const OPENVTC_SESSION_SECRET = process.env.OPENVTC_SESSION_SECRET ?? "";
export const NEXTAUTH_URL =
  process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "";

export const SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY ?? "";

export const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET ?? "";

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";

export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

// ── Auth: Microsoft Entra ID ────────────────────────────────────────────

export const AZURE_AD_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID ?? "";

export const AZURE_AD_CLIENT_SECRET = process.env.AZURE_AD_CLIENT_SECRET ?? "";

export const AZURE_AD_TENANT_ID = process.env.AZURE_AD_TENANT_ID ?? "";

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

// ── Logging & Runtime ───────────────────────────────────────────────────

export const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

export const NODE_ENV = process.env.NODE_ENV ?? "development";

export const NEXT_RUNTIME = process.env.NEXT_RUNTIME ?? "";

/** User home directory (system). */
export const HOME = process.env.HOME ?? "";
