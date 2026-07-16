export const meta = {
  name: "phase-18-entra-sso",
  description:
    "Add Microsoft Entra ID (Azure AD) as a NextAuth SSO provider so staff onboard via Microsoft login. Demo beat 3b. The Azure app registration ALREADY EXISTS (provisioned 2026-07-04 via az CLI); this workflow only wires the code + the live-login verification.",
  phases: [
    {
      title: "Provider wiring",
      detail: "Add microsoft-entra-id provider to NextAuth config, env-gated",
    },
    {
      title: "Onboarding link",
      detail: "Surface 'Sign in with Microsoft' + map to org membership",
    },
    {
      title: "Live login test",
      detail:
        "Confirm the real app reg completes an OIDC round-trip in oauth mode",
    },
    { title: "Verify+Commit", detail: "tsc + config check + commit + gbrain" },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;

// VERIFIED SEAMS (2026-07-04):
// - apps/web/src/lib/auth/nextauth-config.ts: providers = Google only (gated on
//   GOOGLE_CLIENT_ID). auth-mode.ts supports "cloud"|"oauth"|"local".
// - runtime-config.ts: authMode is provider-agnostic; oauth mode enables OAuth generally.
// - M365 connector refs exist (cloud-app-registry) but are READ connectors, not identity.
const CTX = `
Repo: ${REPO}
Web: ${WEB}
NextAuth config: apps/web/src/lib/auth/nextauth-config.ts (Google only today).

HARD FACTS (verified — do not contradict):
- Only Google provider is wired. AUTH_MODE controls whether OAuth is on at all.
- THE AZURE APP REGISTRATION ALREADY EXISTS (provisioned 2026-07-04 via az CLI, single-tenant,
  giniresearch.onmicrosoft.com). Do NOT tell the owner to create one. The values are already in
  the gitignored .env:
    AZURE_AD_CLIENT_ID=ba30d158-a7f8-41d0-b816-2aed0d0c29c8
    AZURE_AD_TENANT_ID=aefd01f4-0c03-4765-9f4f-76f05b4ec2d0
    AZURE_AD_CLIENT_SECRET=<in .env, do NOT print>
  Redirect URIs registered: http://127.0.0.1:10254/api/auth/callback/microsoft-entra-id and the
  localhost variant. Delegated Graph scopes openid/profile/email/User.Read are admin-consented.
- Do NOT break local mode (AUTH_MODE=local, no login) — Entra must be additive and env-gated,
  exactly like Google is (only appears when its env vars are set).
- Use the current NextAuth (Auth.js) Microsoft Entra provider import that matches the installed
  version — CHECK the installed next-auth/@auth version in package.json before choosing the
  import path (microsoft-entra-id provider path differs between v4 and v5). NOTE: recent Auth.js
  renamed the provider id/import from "azure-ad" to "microsoft-entra-id" and the callback path
  follows the provider id — the registered redirect URI uses /microsoft-entra-id, so the provider
  id MUST resolve to that. If the installed version only offers "azure-ad", either add an
  azure-ad redirect URI to the app reg (az ad app update) OR pin the provider id; do not leave a
  callback-path mismatch.
`;

phase("Provider wiring");
const provider = await agent(
  `${CTX}
## Agent 18-A: Wire Microsoft Entra ID provider (env-gated)

1. Check the installed Auth.js/next-auth version in apps/web/package.json. Use the correct
   Microsoft Entra ID provider for that version (v5: "next-auth/providers/microsoft-entra-id";
   v4: "@auth/core" equivalent or next-auth/providers/azure-ad). Do NOT guess — match the version.
2. In nextauth-config.ts, add the Entra provider to the providers array, gated on
   AZURE_AD_CLIENT_ID / AZURE_AD_CLIENT_SECRET / AZURE_AD_TENANT_ID (mirror how Google is gated
   on GOOGLE_CLIENT_ID). If those env vars are absent, the provider is simply not added — local
   mode and existing Google behavior unchanged.
3. Add the new env vars to the env schema/types and .env.example (do NOT put real secrets in git).
4. Ensure the profile mapping populates email/name so downstream org-membership logic works.

Run: cd ${REPO}/apps/web && npx tsc --noEmit
Return: files changed, the exact provider import used + why (version), tsc result.
`,
  { label: "18-A:provider-wiring", phase: "Provider wiring", effort: "high" },
);

phase("Onboarding link");
const onboarding = await agent(
  `${CTX}
## Agent 18-B: 'Sign in with Microsoft' + org membership mapping

1. On the sign-in surface, add a "Sign in with Microsoft" button that only renders when the
   Entra env vars are present (feature-detect via a server-provided flag; do NOT leak secrets).
2. On first Entra sign-in, ensure the user is associated with an Organization + OrganizationMember
   row (reuse existing signup/onboarding association logic; if phase-9 member-service exists,
   use it). Default role = member (Employee). Do NOT auto-grant admin.
3. If AUTH_MODE=local, this button is hidden (local mode has no login) — verify that path.

Run tsc. Return files changed + tsc result + how membership is created on first login.
`,
  { label: "18-B:onboarding-link", phase: "Onboarding link" },
);

phase("Live login test");
const liveTest = await agent(
  `${CTX}
## Agent 18-C: Confirm the real app registration completes an OIDC round-trip

The app reg is already live. Prove the code + reg actually work together (this is the part
that a manual runbook could not verify). Do NOT just assert config is present.

1. The default local mode is AUTH_MODE=local (no login), so the Entra button won't show.
   Start (or point at) a web instance with AUTH_MODE=oauth and the AZURE_AD_* vars loaded from
   .env, on the SAME origin the redirect URI expects (http://127.0.0.1:10254). Do NOT commit any
   auth-mode change to the default local dev; use an env override for the test only.
2. Hit the NextAuth provider metadata / signin endpoints and confirm the microsoft-entra-id
   provider is listed:
     curl -s http://127.0.0.1:10254/api/auth/providers | python3 -m json.tool
   Assert an entry whose callbackUrl ends in /callback/microsoft-entra-id.
3. Confirm the authorize redirect is well-formed (client_id + tenant + redirect_uri match the
   app reg). You can initiate signin and inspect the 302 Location header:
     curl -s -o /dev/null -D - "http://127.0.0.1:10254/api/auth/signin/microsoft-entra-id" | grep -i location
   Assert it points at login.microsoftonline.com/<tenant>/... with the right client_id and the
   registered redirect_uri. (A full browser login with real credentials is a manual demo-day
   step; the automated proof is that the round-trip is correctly wired end to the IdP.)
4. Also write docs/plan/runbooks/entra-sso-setup.md, but as an "ALREADY PROVISIONED" record:
   the app reg IDs (client + tenant, NOT the secret), redirect URIs, consented scopes, how it was
   created (az CLI, 2026-07-04), how to rotate the secret, and how to flip a demo instance into
   oauth mode. This is now a maintenance/rotation runbook, not a setup blocker.

Return: the /api/auth/providers output (PASTE), the authorize Location header (PASTE, redact
nothing structural but do not print the client secret), and the runbook path. If oauth-mode can't
be started in this environment, say so explicitly and fall back to asserting the provider is wired
+ the redirect URI matches — do NOT claim a live round-trip you didn't observe.
`,
  { label: "18-C:live-login-test", phase: "Live login test", effort: "high" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 18-D: Verify + commit

PASTE real output:
  cd ${REPO}/apps/web && npx tsc --noEmit
  # Confirm local mode still works (no login) and no secrets committed:
  git grep -nE "AZURE_AD_CLIENT_SECRET=" -- ':!*.example' || echo "no secret leaked (good)"
  curl -s -o /dev/null -w "web:%{http_code}\\n" http://127.0.0.1:10254

Only commit if tsc clean and NO secret is committed:
  cd ${REPO}
  git add -A apps/web/ docs/plan/
  git commit -m "feat(auth): Microsoft Entra ID SSO provider (env-gated)

Add microsoft-entra-id NextAuth provider, gated on AZURE_AD_* env vars (additive,
does not affect local mode or Google). First Entra sign-in maps to an
OrganizationMember (role: Employee). App registration already provisioned in the
giniresearch tenant (client ba30d158-..., single-tenant, openid/profile/email/User.Read
admin-consented); runbook is now rotation/maintenance only. Demo beat 3b.

tsc --noEmit: clean; no secrets committed

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-enterprise-ux-gap.md (do NOT run
gbrain import — key broken). Update STATE.md. Note the app reg is live (not owner-blocked).
Return commit hash + pasted output.
`,
  { label: "18-D:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { provider, onboarding, liveTest, commit };
