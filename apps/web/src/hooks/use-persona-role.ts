"use client";

import { useEffect, useState } from "react";
import { getPersonaRole, type PersonaRole } from "@/lib/role-preference";

/**
 * Returns the current persona role from localStorage (client-side only).
 *
 * In production this would come from the authenticated session's org member
 * role. During local dev / demo, the persona switcher writes to localStorage
 * and this hook reads it so components can gate actions with explanatory UX.
 *
 * Returns "admin" on the server (SSR) as the safest default to avoid
 * flashing false disabled states on initial render.
 */
export function usePersonaRole(): PersonaRole {
  const [role, setRole] = useState<PersonaRole>("admin");

  useEffect(() => {
    setRole(getPersonaRole());

    // Re-sync when another tab/window changes the preference.
    const handler = (e: StorageEvent) => {
      if (e.key === "oc_role_pref" && e.newValue) {
        setRole(e.newValue as PersonaRole);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return role;
}

/** Returns true when the role is allowed to perform Cyber/Admin-only actions. */
export function useCanCyberAdmin(): boolean {
  const role = usePersonaRole();
  return role === "admin" || role === "owner";
}

/** Returns true when the role can approve/deny team approval requests. */
export function useCanApprove(): boolean {
  const role = usePersonaRole();
  return role === "admin" || role === "owner" || role === "manager";
}

/** Returns true when the role can manage (create/delete) policy rules. */
export function useCanManagePolicy(): boolean {
  const role = usePersonaRole();
  return role === "admin" || role === "owner";
}

/** Returns true only for the Owner persona (e.g. destructive demo-data reset). */
export function useIsOwner(): boolean {
  const role = usePersonaRole();
  return role === "owner";
}
