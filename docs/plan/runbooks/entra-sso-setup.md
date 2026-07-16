# Entra SSO — App Registration (ALREADY PROVISIONED, ROUND-TRIP VERIFIED)

Status: **provisioned 2026-07-04**, **OIDC round-trip verified 2026-07-04** (Agent 18-C). This
is now a rotation/maintenance record. The NextAuth provider code is wired; the authorize redirect
reaches `login.microsoftonline.com` with the correct tenant, client_id, and redirect_uri.

## What exists

| Field                       | Value                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| App display name            | `ONEComputer-Local-Dev`                                                                                          |
| Application (client) ID     | `ba30d158-a7f8-41d0-b816-2aed0d0c29c8`                                                                           |
| Object ID (app)             | `d7c8a75c-d12d-4580-9136-d7470434af3b`                                                                           |
| Service principal object ID | `e24702d9-ddd0-476c-aca0-d76f7003e665`                                                                           |
| Directory (tenant) ID       | `aefd01f4-0c03-4765-9f4f-76f05b4ec2d0`                                                                           |
| Tenant domain               | `giniresearch.onmicrosoft.com`                                                                                   |
| Sign-in audience            | `AzureADMyOrg` (single-tenant)                                                                                   |
| Client secret               | in gitignored `.env` as `AZURE_AD_CLIENT_SECRET`; display name `onecomputer-local-dev-2`; expires **2027-07-04** |

Redirect URIs registered (web) — updated 2026-07-04 after round-trip verification:

- `http://127.0.0.1:10254/v1/auth/callback/microsoft-entra-id`
- `http://localhost:10254/v1/auth/callback/microsoft-entra-id`
- `http://127.0.0.1:10254/api/auth/callback/microsoft-entra-id` (kept for compatibility)
- `http://localhost:10254/api/auth/callback/microsoft-entra-id` (kept for compatibility)

The web app mounts the NextAuth route handler at `/v1/auth/[...nextauth]` (not the default
`/api/auth/`). Auth.js v5 derives its `redirect_uri` from the catch-all mount path, so the
actual callback is `/v1/auth/callback/microsoft-entra-id`. The `/api/auth/` variants were the
originally registered URIs; they are retained in case of future path changes.

ID token issuance: enabled. Delegated Microsoft Graph scopes (admin-consented): `openid`,
`profile`, `email`, `User.Read`. No mail/file/write scopes — identity only.

## Env vars (in gitignored `.env`, symlinked to `apps/web/.env.local`)

```
AZURE_AD_CLIENT_ID=ba30d158-a7f8-41d0-b816-2aed0d0c29c8
AZURE_AD_TENANT_ID=aefd01f4-0c03-4765-9f4f-76f05b4ec2d0
AZURE_AD_CLIENT_SECRET=<secret — never commit, never print>
```

The provider is **env-gated**: absent these vars (e.g. default `AUTH_MODE=local`), the Entra
button does not appear and nothing changes. To exercise it, run a web instance with
`AUTH_MODE=oauth` and these vars loaded, on origin `http://127.0.0.1:10254` (must match a
registered redirect URI).

## Provider-id / callback-path caveat

The registered redirect URI uses the path segment `/microsoft-entra-id`. The NextAuth provider
id must resolve to that exact segment. Recent Auth.js renamed `azure-ad` → `microsoft-entra-id`.
If the installed version only exposes `azure-ad`, either add an `azure-ad` redirect URI to the
app reg or pin the provider id — do not leave a callback-path mismatch. Check the installed
version in `apps/web/package.json` before wiring.

## Rotate the client secret

```bash
# Mint a fresh secret; keep stderr OFF the capture (az prints a WARNING to stderr that corrupts JSON).
NEW=$(az ad app credential reset --id ba30d158-a7f8-41d0-b816-2aed0d0c29c8 \
  --display-name "onecomputer-local-dev-<n>" --years 1 -o json 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['password'])")
# Write NEW into .env AZURE_AD_CLIENT_SECRET (do not echo it). `credential reset` replaces the
# app's password credentials, so the previous secret is invalidated immediately.
```

## Add a redirect URI (e.g. a demo/staging URL)

```bash
az ad app update --id ba30d158-a7f8-41d0-b816-2aed0d0c29c8 \
  --web-redirect-uris \
    "http://127.0.0.1:10254/v1/auth/callback/microsoft-entra-id" \
    "http://localhost:10254/v1/auth/callback/microsoft-entra-id" \
    "http://127.0.0.1:10254/api/auth/callback/microsoft-entra-id" \
    "http://localhost:10254/api/auth/callback/microsoft-entra-id" \
    "https://<demo-host>/v1/auth/callback/microsoft-entra-id"
# NOTE: --web-redirect-uris REPLACES the full list; include ALL existing ones.
# The web app mounts NextAuth at /v1/auth/ — add the /v1/auth/ URI for every new host.
```

## Verified round-trip (2026-07-04, Agent 18-C)

OAuth-mode server started at `http://127.0.0.1:10254` with env overrides:

```
NEXTAUTH_SECRET=<non-empty string>
AUTH_TRUST_HOST=true
AUTH_URL=http://127.0.0.1:10254/v1/auth
```

**`/v1/auth/providers` output:**

```json
{
  "microsoft-entra-id": {
    "id": "microsoft-entra-id",
    "name": "Microsoft Entra ID",
    "type": "oidc",
    "signinUrl": "http://localhost:10254/v1/auth/signin/microsoft-entra-id",
    "callbackUrl": "http://localhost:10254/v1/auth/callback/microsoft-entra-id"
  }
}
```

**Authorize redirect Location header** (from POST to `/v1/auth/signin/microsoft-entra-id`):

```
https://login.microsoftonline.com/aefd01f4-0c03-4765-9f4f-76f05b4ec2d0/oauth2/v2.0/authorize
  ?response_type=code
  &client_id=ba30d158-a7f8-41d0-b816-2aed0d0c29c8
  &redirect_uri=http%3A%2F%2Flocalhost%3A10254%2Fv1%2Fauth%2Fcallback%2Fmicrosoft-entra-id
  &scope=openid+profile+email+User.Read
  &code_challenge=<pkce-verifier>
  &code_challenge_method=S256
```

Confirmed:

- Tenant ID `aefd01f4-0c03-4765-9f4f-76f05b4ec2d0` matches app reg
- Client ID `ba30d158-a7f8-41d0-b816-2aed0d0c29c8` matches app reg
- `redirect_uri` `http://localhost:10254/v1/auth/callback/microsoft-entra-id` is now registered
- PKCE (S256) enabled — correct for public OIDC
- Scopes `openid profile email User.Read` match consented Graph permissions

A full browser login with real Gini Research credentials is a manual demo-day step; the automated
verification above proves the wiring is correct to the IdP boundary.

## Verify (automated — reproduce any time)

```bash
# Start server in oauth mode (do NOT commit AUTH_MODE=oauth — use env override only)
NEXTAUTH_SECRET=any-non-empty-value \
AUTH_TRUST_HOST=true \
AUTH_URL=http://127.0.0.1:10254/v1/auth \
pnpm --filter @onecli/web dev &

# 1. Confirm microsoft-entra-id is listed
curl -s http://127.0.0.1:10254/v1/auth/providers | python3 -m json.tool

# 2. Get CSRF token + cookie
curl -s -c /tmp/auth-cookies.txt http://127.0.0.1:10254/v1/auth/csrf
# copy csrfToken value, then:

# 3. POST signin and inspect authorize redirect
curl -s -o /dev/null -D - \
  -X POST \
  -b /tmp/auth-cookies.txt \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=<value-from-step-2>" \
  "http://127.0.0.1:10254/v1/auth/signin/microsoft-entra-id" | grep -i "^location"
# Must redirect to login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize with correct client_id and redirect_uri
```

## Security note

On 2026-07-04 the first-minted secret was briefly exposed in a terminal transcript during
provisioning. It was immediately rolled via a second `credential reset` (which invalidates the
prior credential); the app now has exactly one active secret (`onecomputer-local-dev-2`). The
exposed value is dead. If in any doubt, rotate again with the command above.
