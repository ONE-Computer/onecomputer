import type { AuthUser } from "./types";
import { getServerSessionImpl } from "@/lib/auth/auth-server";

/**
 * No-arg form for server actions / RSC that don't have an inbound request in
 * scope. Never applies the dev-only persona override (the override is a
 * property of the inbound HTTP request, not background work). Always resolves
 * to the default local-admin session in local mode.
 */
export const getServerSession = async (): Promise<AuthUser | null> =>
  getServerSessionImpl();

/**
 * Request-aware form for the API session provider. In local + dev mode this
 * honors the `?persona=` / `X-OneComputer-Persona` override (ONE-125).
 */
export const getServerSessionForRequest = async (
  request: Request,
): Promise<AuthUser | null> => getServerSessionImpl(request);
