# 013: own the Microsoft 365 connection journey

Status: `verification`

Gate: F
Depends on: 002 and the conditional credential-custody pass in 008
Unblocks: completion of 008

## Outcome

A signed-in ONEComputer user can connect or disconnect Microsoft 365 from the
owned product UI while LiteLLM remains the encrypted per-user OAuth credential
custodian for the `onecomputer_ms365` MCP server.

## In scope

- Add one Microsoft 365 connection card to ONEComputer Web.
- Bind the OAuth attempt to the authenticated ONEComputer tenant and subject.
- Use a short-lived, server-side LiteLLM connection key whose `user_id` matches
  the deterministic ONEComputer user mapping.
- Complete authorization-code plus PKCE through the pinned LiteLLM MCP OAuth
  endpoints and store the resulting credential in LiteLLM's per-user MCP
  credential record.
- Return only safe connected/disconnected, expiry, and connection-time metadata
  to the browser.
- Disconnect by deleting the mapped user's MCP OAuth credential.

## Out of scope

- A connector marketplace, generic plugin framework, agent/workspace assignment
  UI, policy editor, Microsoft write tools, or storing OAuth tokens in
  ONEComputer PostgreSQL.
- LiteLLM Chat -> Integrations or exposing the LiteLLM administrator session.
- Moving credential custody to OneCLI. OneCLI remains a future alternative
  custodian, not a second copy of the refresh token.

## Required implementation

- Control owns a single-use, expiring OAuth state and PKCE verifier. Replays,
  identity mismatches, expired state, missing state, and provider errors deny.
- The gateway adapter resolves the pinned MCP server, creates a narrow
  connection key, relays authorization, performs token exchange without logging
  or persisting the returned token outside LiteLLM, reads safe status, and
  deletes the user credential on disconnect.
- Browser responses, application pages/history after the mandatory one-time
  callback, logs, errors, and evidence must not contain the LiteLLM key,
  authorization code, access token, refresh token, client secret, or master
  key. The provider's short-lived callback query is immediately replaced by a
  clean product URL and is never request-logged.

## Required verification

- [x] The owned page displays disconnected, connecting/error, and connected
  states without linking to LiteLLM Chat -> Integrations.
- [x] The OAuth start uses a mapped ONEComputer `user_id` and a narrow
  connection key; that key cannot administer models, arbitrary keys, or other
  MCP servers.
- [ ] Synthetic authorization-code plus PKCE stores a per-user credential and
  the safe status endpoint reports it without returning token material.
- [x] A second user cannot finish, inspect, or disconnect the first user's
  attempt or credential.
- [x] Expired, replayed, missing, malformed, and provider-denied callbacks fail
  closed.
- [x] Disconnect removes only the calling user's Microsoft 365 credential.
- [ ] Real Microsoft OAuth is completed by the user and bounded read-only
  OneDrive, Mail, and Calendar discovery succeeds through the sandbox agent key.
- [ ] Tests, build, deployed inspection, and log scans contain no prohibited
  credential material.

## Evidence required

Record the pinned LiteLLM and Softeria versions, safe endpoint/status probes,
cross-user and replay results, deployed browser journey, credential/log scan,
and the remaining production ingress limitation.

## Stop conditions

- The pinned gateway cannot bind stored OAuth credentials to the mapped
  ONEComputer user without exposing a master or bearer credential to the
  browser.
- OAuth completion requires LiteLLM Chat identity or stores a duplicate refresh
  token outside the selected gateway/provider seam.
- The real Entra callback cannot be restricted to the configured tenant or
  requested read-only scopes.

## Completion record

Not complete. The owned page, identity-bound PKCE flow, narrow connection key,
safe status, disconnect, replay/cross-user denials, build, local deployment,
redirect chain, and pre-consent log scan passed on 2026-07-20. Evidence is in
`infra/issue-013/qualification-pre-oauth-2026-07-20.md`. The final live OAuth
and bounded Microsoft read probes require the user's interactive consent.
