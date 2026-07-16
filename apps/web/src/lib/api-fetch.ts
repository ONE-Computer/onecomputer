import { getPersonaRole } from "@/lib/role-preference";

export const API_ORIGIN = "";

export const getAuthToken = async (): Promise<string | undefined> => undefined;

export const getProjectId = (): string | undefined => undefined;

export const getOrganizationId = (): string | undefined => undefined;

export const apiFetch = (
  path: string,
  options?: RequestInit,
): Promise<Response> => {
  const headers = new Headers(options?.headers);
  headers.set("content-type", "application/json");

  // The server honors this only in local auth mode and non-production builds.
  // Without the header, the persona switcher changes presentation but every
  // API request continues to execute as local-admin, invalidating RBAC tests.
  if (typeof window !== "undefined") {
    const queryPersona = new URLSearchParams(window.location.search).get(
      "persona",
    );
    headers.set("x-onecomputer-persona", queryPersona ?? getPersonaRole());
  }

  return fetch(path, { ...options, headers });
};
