# Issue 013 pre-OAuth qualification — 2026-07-20

## Result

The owned ONEComputer Microsoft 365 connection journey is deployed locally and
ready for interactive Entra consent. This is a pre-consent pass, not closure of
Issue 013 or Issue 008.

## Pinned runtime

- LiteLLM `v1.93.0`, image digest
  `sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e`.
- Softeria `ms-365-mcp-server` `0.131.2`, built by the pinned Issue 008
  container definition.
- Microsoft 365 remains registered as the private LiteLLM MCP server
  `onecomputer_ms365`; LiteLLM Chat -> Integrations is not used.

## Implemented boundary

- ONEComputer Web exposes one Microsoft 365 connection card.
- Control creates a single-use ten-minute OAuth state plus S256 PKCE verifier
  bound to the authenticated ONEComputer tenant and subject.
- The LiteLLM adapter creates a deterministic short-lived connection key whose
  `user_id` is the mapped ONEComputer user and whose routes are limited to the
  selected MCP server's authorize, token, safe status, and delete endpoints.
- LiteLLM stores the per-user MCP credential. Control cancels the token response
  body without parsing, logging, returning, or persisting it, then reads only
  the gateway's safe credential status.
- Callback request logging is disabled for the route carrying the mandatory
  one-time authorization code, and the browser is immediately redirected to a
  clean ONEComputer URL.

## Automated checks

`npm run build` passed for all workspaces. `npm test` passed `41/41` tests,
including:

- deterministic separation of user connection, workspace, agent, and master
  credentials;
- exact narrow connection routes and server object permission;
- token-response non-propagation;
- state/PKCE identity binding;
- cross-user denial, callback replay denial, expiry, malformed response, and
  provider-denial behavior;
- safe callback redirect and calling-user-only disconnect.

## Deployed pre-consent inspection

- All local services were healthy after rebuild; the existing Kasm workspace
  remained running.
- `GET /api/v1/connections/microsoft-365` returned only `state`,
  `connectedAt`, and `expiresAt`, with state `disconnected`.
- The owned authorize route returned `302` to the pinned connector at
  `http://localhost:3001/authorize` and set an opaque HttpOnly relay cookie.
- The connector returned `302` to the configured tenant's Microsoft identity
  endpoint. The client ID and tenant matched the configured Entra application,
  S256 PKCE was present, and the registered upstream callback was
  `http://localhost:4000/callback`.
- A final safe-status request removed the temporary connection key; zero
  ONEComputer connection keys remained before handoff.
- Control, LiteLLM, and Softeria logs contained none of the configured master,
  salt, adapter, client-secret values and no access-token, refresh-token, or
  authorization-code query markers.

## Remaining verification

The user must click **Connections -> Connect Microsoft 365**, sign in with the
intended tenant account, and return to a visible `Connected` state. After that,
run bounded read-only Mail, Calendar, and OneDrive discovery through the mapped
sandbox agent key; verify restart/refresh behavior and repeat the credential and
log scan.

## Residual risks

- Pending OAuth state is intentionally in-memory for the local single-worker
  qualification. A Control restart during consent invalidates the attempt and
  requires a clean retry. Production ingress needs a durable, encrypted,
  single-use session or sticky callback contract.
- LiteLLM's pinned token endpoint returns the token response to its trusted
  caller after storing it. The adapter never parses or retains that body and
  cancels it immediately. If future assurance requires the token payload never
  to traverse the Control process at all, introduce a private gateway-side
  completion adapter rather than exposing it to the browser.
- The current surface is read-only. Microsoft write tools and policy assignment
  UI remain explicitly out of scope.
