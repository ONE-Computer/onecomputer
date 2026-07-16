import { readFileSync } from "fs";
import {
  AZURE_AD_CLIENT_ID,
  AZURE_AD_CLIENT_SECRET,
  AZURE_AD_TENANT_ID,
  AUTH_MODE,
  EDITION,
  GOOGLE_CLIENT_ID,
  NEXTAUTH_SECRET,
  NODE_ENV,
  OPENVTC_RP_DID,
} from "@/lib/env";

interface RuntimeConfig {
  authMode: "cloud" | "oauth" | "local" | "openvtc";
  oauthConfigured: boolean;
  entraConfigured: boolean;
  openVtcConfigured: boolean;
}

const RUNTIME_CONFIG_PATH = "/app/data/runtime-config.json";

const CLOUD_CONFIG: RuntimeConfig = {
  authMode: "cloud",
  oauthConfigured: true,
  entraConfigured: false,
  openVtcConfigured: false,
};

let cached: RuntimeConfig | null = null;

/**
 * Reads the runtime config written by the Docker entrypoint at container start.
 * Cloud edition short-circuits (edition is a build-time decision).
 * Falls back to direct env-var checks for local development (no Docker).
 */
export const getRuntimeConfig = (): RuntimeConfig => {
  if (EDITION === "cloud") return CLOUD_CONFIG;
  if (cached) return cached;

  try {
    cached = JSON.parse(readFileSync(RUNTIME_CONFIG_PATH, "utf-8"));
    return cached!;
  } catch {
    if (AUTH_MODE === "local" || AUTH_MODE === "openvtc") {
      cached = {
        authMode: AUTH_MODE,
        oauthConfigured: false,
        entraConfigured: false,
        openVtcConfigured: AUTH_MODE === "openvtc" && !!OPENVTC_RP_DID,
      };
      return cached;
    }

    // Local dev (no Docker) — read env vars directly.
    // During Next.js build prerendering this also runs, but since all pages
    // are client-rendered behind auth anyway, the fallback value is fine.
    const entraConfigured =
      !!AZURE_AD_CLIENT_ID && !!AZURE_AD_CLIENT_SECRET && !!AZURE_AD_TENANT_ID;

    // Surface a common misconfiguration: Entra (or Google) creds are present
    // but NEXTAUTH_SECRET is empty, so authMode silently stays "local" and the
    // OAuth provider button never renders. One-shot warning per process.
    if (
      NODE_ENV !== "production" &&
      !NEXTAUTH_SECRET &&
      (entraConfigured || !!GOOGLE_CLIENT_ID)
    ) {
      console.warn(
        `[auth] NEXTAUTH_SECRET is empty but OAuth provider credentials are set. ` +
          `authMode will be "local" (hardcoded admin@localhost user) and the ` +
          `OAuth sign-in button will not render. Set NEXTAUTH_SECRET ` +
          `(openssl rand -base64 32) to enable OAuth mode.`,
      );
    }

    cached = {
      authMode: NEXTAUTH_SECRET ? "oauth" : "local",
      oauthConfigured: !!GOOGLE_CLIENT_ID,
      entraConfigured,
      openVtcConfigured: false,
    };
    return cached;
  }
};
