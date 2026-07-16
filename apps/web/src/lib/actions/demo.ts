"use server";

/**
 * Server action backing the "Reset demo data" button (Settings → Instance).
 *
 * Runs in-process — this app mounts the API's Hono app directly
 * (apps/web/src/app/api/[[...route]]/route.ts), so there is no separate
 * network hop to guard with `internalAuth`. The real authorization boundary
 * is `DEMO_MODE_ENABLED`, re-checked here server-side: it is hard-disabled
 * whenever `EDITION=cloud` or `NODE_ENV=production`, so this action cannot
 * run in a real deployment even if a client somehow calls it directly.
 *
 * The Owner-persona + local-mode checks in the UI (reset-demo-data-card.tsx)
 * are UX affordance only, matching every other simulated-persona gate in
 * this app (role-preference.ts) — they are not the security boundary.
 *
 * Delegates to the exact same functions the CLI (`pnpm seed:demo:reset`)
 * uses, so there is only one implementation of "what demo reset means."
 */
import { revalidatePath } from "next/cache";
import { DEMO_MODE_ENABLED } from "@onecli/api/lib/env";
import { resetDemoNamespace, runDemoSeed } from "@onecli/api/scripts/seed-demo";

export const resetDemoData = async () => {
  if (!DEMO_MODE_ENABLED) {
    throw new Error("Demo reset is disabled outside local/demo mode");
  }

  const deleted = await resetDemoNamespace();
  const seeded = await runDemoSeed();

  // The reset can touch the caller's own org/members/agents/rules if they
  // happen to be operating inside Demo Corp — revalidate broadly so every
  // dashboard surface picks up the fresh seed instead of stale cached data.
  revalidatePath("/", "layout");

  return { deleted, seeded };
};
