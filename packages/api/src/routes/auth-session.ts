import { Hono } from "hono";
import { db } from "@onecli/db";
import { getSessionProvider } from "../providers";
import { logger } from "../lib/logger";
import {
  findUserDefaultProject,
  bootstrapOrganization,
  ensureProjectSeeds,
} from "../services/organization-service";
import { acceptPendingInvitationForEmail } from "../services/member-service";

/** Extra attributes to spread into the user upsert (create + update). */
export type SessionAttributes = Record<string, unknown>;

export interface SessionHooks {
  getSessionAttributes(request: Request): SessionAttributes;
  onUserCreated(
    user: { email: string; name: string | null },
    attributes: SessionAttributes,
  ): void;
  shouldBootstrapOrg(request: Request): boolean;
  augmentSessionResponse(userId: string): Promise<Record<string, unknown>>;
}

const defaultHooks: SessionHooks = {
  getSessionAttributes: () => ({}),
  onUserCreated: () => {},
  shouldBootstrapOrg: () => true,
  augmentSessionResponse: async () => ({}),
};

let _hooks: SessionHooks = defaultHooks;

export const initSessionHooks = (hooks: Partial<SessionHooks>) => {
  _hooks = { ...defaultHooks, ...hooks };
};

/**
 * Resolve the caller's OrgRole for the session response so the client (and the
 * dev-only persona switcher, ONE-125) can observe the effective role without a
 * separate round-trip. Mirrors the OrganizationMember lookup that
 * middleware/ability.ts uses as its role fallback, so the value reported here
 * matches what gates `withAbility` / strictest-wins policy merge.
 */
const resolveRoleForSession = async (
  userId: string,
  organizationId: string,
): Promise<string | null> => {
  const member = await db.organizationMember.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });
  return member?.role ?? null;
};

/**
 * GET /auth/session
 *
 * Single endpoint that handles the full auth -> DB sync flow:
 * 1. Reads the auth session (cookie/token)
 * 2. Upserts the user in the database
 * 3. Ensures the user has an Organization + Project + ApiKey + Agent
 * 4. Returns the user profile with projectId
 *
 * Called by the login page after auth and by the dashboard layout on mount.
 * Returns 401 if no valid session exists.
 */
export const authSessionRoutes = () => {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const session = getSessionProvider();
      const user = await session.getSession(c.req.raw);
      if (!user || !user.email) {
        return c.json({ error: "Not authenticated" }, 401);
      }

      const extra = _hooks.getSessionAttributes(c.req.raw);

      const existingUser = await db.user.findUnique({
        where: { email: user.email },
        select: { id: true },
      });

      const dbUser = await db.user.upsert({
        where: { email: user.email },
        create: {
          externalAuthId: user.id,
          email: user.email,
          name: user.name,
          lastLoginAt: new Date(),
          ...extra,
        },
        update: {
          externalAuthId: user.id,
          name: user.name,
          lastLoginAt: new Date(),
          ...extra,
        },
        select: { id: true, email: true, name: true },
      });

      let defaultProject = await findUserDefaultProject(dbUser.id);

      // Multi-user IAM (ONE-144): a brand-new Entra/OAuth user who was invited
      // to an existing org must land as a member of that org (with the role the
      // inviter chose), NOT bootstrap their own org as owner. Check for a
      // pending invitation before falling back to org bootstrap. Only runs for
      // first-time users (existingUser === null) — a returning member already
      // has a membership and resolves via findUserDefaultProject above.
      if (!defaultProject && !existingUser) {
        const accepted = await acceptPendingInvitationForEmail(
          dbUser.email,
          dbUser.id,
        );
        if (accepted) {
          defaultProject = accepted.projectId
            ? {
                id: accepted.projectId,
                organizationId: accepted.organizationId,
              }
            : null;
          _hooks.onUserCreated(
            { email: dbUser.email, name: dbUser.name },
            extra,
          );
        }
      }

      if (
        !defaultProject &&
        !existingUser &&
        _hooks.shouldBootstrapOrg(c.req.raw)
      ) {
        const result = await bootstrapOrganization(
          dbUser.id,
          dbUser.email,
          dbUser.name ?? undefined,
        );
        defaultProject = result.project;
        _hooks.onUserCreated({ email: dbUser.email, name: dbUser.name }, extra);
      }

      // Edge case (ONE-144): invitation was accepted but the org had no
      // project yet. Create a default project so the new member has a home
      // instead of being bounced through the no-project 401 path.
      if (!defaultProject && existingUser === null) {
        const accepted = await db.organizationMember.findFirst({
          where: { userId: dbUser.id },
          select: { organizationId: true },
          orderBy: { createdAt: "asc" },
        });
        if (accepted) {
          const created = await db.project.create({
            data: {
              name: "Default",
              slug: "default",
              organizationId: accepted.organizationId,
              createdByUserId: dbUser.id,
              createdByUserEmail: dbUser.email,
            },
            select: { id: true, organizationId: true },
          });
          defaultProject = created;
        }
      }

      if (defaultProject) {
        const projectId = defaultProject.id;

        await ensureProjectSeeds(projectId, dbUser.id, dbUser.email);

        const role = await resolveRoleForSession(
          dbUser.id,
          defaultProject.organizationId,
        );

        return c.json({
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          projectId,
          organizationId: defaultProject.organizationId,
          role,
        });
      }

      const responseExtra = await _hooks.augmentSessionResponse(dbUser.id);

      return c.json({
        id: dbUser.id,
        email: dbUser.email,
        name: dbUser.name,
        ...responseExtra,
      });
    } catch (err) {
      logger.error(
        { err, route: "GET /v1/auth/session" },
        "session sync failed",
      );
      return c.json({ error: "Internal server error" }, 500);
    }
  });

  return app;
};
