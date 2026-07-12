import { auth } from "@/lib/auth/nextauth-config";
import { db } from "@onecli/db";
import { cookies } from "next/headers";
import {
  findUserDefaultProject,
  bootstrapOrganization,
} from "@onecli/api/services/organization-service";
import { getAuthMode } from "./auth-mode";
import { ONECOMPUTER_E2E_DEMO_AUTH } from "@/lib/env";
import type { AuthUser } from "./types";
import {
  OPENVTC_SESSION_COOKIE,
  parseOpenVtcSession,
  userForOpenVtcDid,
} from "./openvtc-session";

const LOCAL_AUTH_ID = "local-admin";
const LOCAL_USER: AuthUser = {
  id: LOCAL_AUTH_ID,
  email: "admin@localhost",
  name: "Admin",
};

/**
 * Dev-only persona switcher (ONE-125).
 *
 * In local auth mode there is no real second Entra user to log in as, so the
 * demo can't show role-based ability differences without this shim. When a
 * `persona` override is supplied (query param `?persona=` or
 * `X-OneComputer-Persona` header) AND the app is in local mode AND
 * NODE_ENV !== 'production', the session resolves to the matching seeded
 * Demo Corp user instead of the local-admin. Each persona maps to a real
 * seeded user (see scripts/seed-demo.ts) whose OrganizationMember row carries
 * the corresponding OrgRole, so the existing role-resolution path
 * (middleware/ability.ts DB lookup) and strictest-wins policy merge behave
 * exactly as they would for a real user with that role.
 *
 * `id` here is the demo user's externalAuthId, which authenticateSession uses
 * to look up the real User row — same as the local-admin flow.
 */
const PERSONA_TO_DEMO_USER: Record<PersonaRole, AuthUser> = {
  owner: {
    id: "demo-owner",
    email: "owner@demo.onecomputer.local",
    name: "Olivia Owner",
  },
  admin: {
    id: "demo-cyber",
    email: "cyber@demo.onecomputer.local",
    name: "Casey Cyber",
  },
  manager: {
    id: "demo-manager",
    email: "manager@demo.onecomputer.local",
    name: "Morgan Manager",
  },
  member: {
    id: "demo-alex",
    email: "alex@demo.onecomputer.local",
    name: "Alex Employee",
  },
};

// These identities are pre-provisioned into Demo Corp for the hosted Azure
// E2E. They deliberately model the OpenVTC/ONEComputer authority boundary,
// without asking the test run to weaken Entra tenant MFA. This mapping is only
// reachable when ONECOMPUTER_E2E_DEMO_AUTH=1 is set explicitly by an operator.
const E2E_PERSONA_TO_DEMO_USER: Record<PersonaRole, AuthUser> = {
  owner: {
    id: "entra-preprovisioned-owner",
    email: "terencetan@giniresearch.onmicrosoft.com",
    name: "Terence Tan",
  },
  admin: {
    id: "entra-preprovisioned-admin",
    email: "demo.admin@giniresearch.onmicrosoft.com",
    name: "Demo Admin",
  },
  manager: {
    id: "entra-preprovisioned-manager",
    email: "demo.manager@giniresearch.onmicrosoft.com",
    name: "Demo Manager",
  },
  member: {
    id: "entra-preprovisioned-member",
    email: "demo.member@giniresearch.onmicrosoft.com",
    name: "Demo Member",
  },
};

export type PersonaRole = "owner" | "admin" | "manager" | "member";

const isPersonaRole = (value: string): value is PersonaRole =>
  value === "owner" ||
  value === "admin" ||
  value === "manager" ||
  value === "member";

/**
 * Extract a dev-only persona override from a request. Returns null when no
 * override is present or when the override is invalid, so callers fall back
 * to the default local-admin session. Production gating happens at the call
 * site (getServerSessionImpl) — this helper only parses.
 */
export const extractPersonaFromRequest = (
  request: Request | undefined,
): PersonaRole | null => {
  if (!request) return null;
  const fromHeader = request.headers.get("x-onecomputer-persona");
  const fromQuery = new URL(request.url).searchParams.get("persona");
  const raw = (fromHeader ?? fromQuery)?.trim().toLowerCase();
  if (!raw || !isPersonaRole(raw)) return null;
  return raw;
};

let localUserEnsured = false;

const ensureLocalUser = async () => {
  if (localUserEnsured) return;

  const user = await db.user.upsert({
    where: { externalAuthId: LOCAL_AUTH_ID },
    create: {
      externalAuthId: LOCAL_AUTH_ID,
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
    },
    update: {},
    select: { id: true },
  });

  const existing = await findUserDefaultProject(user.id);
  if (!existing) {
    await bootstrapOrganization(user.id, LOCAL_USER.email, LOCAL_USER.name);
  }

  localUserEnsured = true;
};

export const getServerSessionImpl = async (
  request?: Request,
): Promise<AuthUser | null> => {
  if (getAuthMode() === "openvtc") {
    const raw = request
      ? request.headers
          .get("cookie")
          ?.split("; ")
          .find((entry) => entry.startsWith(`${OPENVTC_SESSION_COOKIE}=`))
          ?.slice(OPENVTC_SESSION_COOKIE.length + 1)
      : (await cookies()).get(OPENVTC_SESSION_COOKIE)?.value;
    const session = parseOpenVtcSession(raw);
    return session ? userForOpenVtcDid(session.subject) : null;
  }

  if (getAuthMode() === "local") {
    await ensureLocalUser();

    // Dev-only persona override (ONE-125): in local mode + non-production,
    // let `?persona=` / `X-OneComputer-Persona` switch the session to a
    // seeded Demo Corp user so the demo can show role-based ability
    // differences without a real second Entra user. No persona = current
    // local-admin behavior, unchanged.
    if (process.env.NODE_ENV !== "production" || ONECOMPUTER_E2E_DEMO_AUTH) {
      const persona = extractPersonaFromRequest(request);
      if (persona) {
        return ONECOMPUTER_E2E_DEMO_AUTH
          ? E2E_PERSONA_TO_DEMO_USER[persona]
          : PERSONA_TO_DEMO_USER[persona];
      }
    }

    return LOCAL_USER;
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? undefined,
  };
};
