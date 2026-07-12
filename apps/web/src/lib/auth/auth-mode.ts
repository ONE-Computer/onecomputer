import { getRuntimeConfig } from "@/lib/runtime-config";

export type AuthMode = "cloud" | "oauth" | "local" | "openvtc";

export const getAuthMode = (): AuthMode => getRuntimeConfig().authMode;

export const isOAuthConfigured = (): boolean =>
  getRuntimeConfig().oauthConfigured;

export const isEntraConfigured = (): boolean =>
  getRuntimeConfig().entraConfigured;

export const isOpenVtcConfigured = (): boolean =>
  getRuntimeConfig().openVtcConfigured;
