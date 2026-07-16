// Stores and reads the simulated role preference.
// In local dev (AUTH_MODE=local) there's no real role — use localStorage.
// In production this should come from the session's org member role.

const KEY = "oc_role_pref";

export type PersonaRole = "admin" | "manager" | "member" | "owner";

export function getPersonaRole(): PersonaRole {
  if (typeof window === "undefined") return "admin"; // SSR default
  const queryRole = new URLSearchParams(window.location.search).get("persona");
  if (
    queryRole === "admin" ||
    queryRole === "manager" ||
    queryRole === "member" ||
    queryRole === "owner"
  ) {
    localStorage.setItem(KEY, queryRole);
    return queryRole;
  }
  return (localStorage.getItem(KEY) as PersonaRole) ?? "admin";
}

export function setPersonaRole(role: PersonaRole): void {
  localStorage.setItem(KEY, role);
}

export function getLandingPage(role: PersonaRole): string {
  switch (role) {
    case "manager":
      return "/approvals";
    case "member":
      return "/sandboxes";
    case "owner":
      return "/apps";
    default:
      return "/console"; // admin/Cyber
  }
}
