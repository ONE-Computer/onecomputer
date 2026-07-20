# Issue 008 per-user OAuth custody qualification — 2026-07-20

## Result

**Conditional pass for the pinned LiteLLM per-user OAuth custody mechanism.**

The pinned `v1.93.0` gateway demonstrated encrypted per-user credential
storage, selection by key `user_id`, separate agent keys and tool policies,
durability, refresh, expiry, revocation, and workspace isolation. This does not
close Issue 008: a real Entra reconnection under the mapped ONEComputer user,
bounded Microsoft Graph reads, provider failure classification, and the owned
connection journey remain outstanding.

## Qualification fixture

`onecomputer_oauth_fixture` is a private, unassigned MCP server used only to
test credential custody without using real Microsoft tokens for negative
cases. It exposes two harmless tools that return only a SHA-256 credential
fingerprint. The harness creates:

- user Alpha with separate Research and Calendar agent keys;
- user Beta with a separate Research agent key;
- narrow user connection keys that may manage only the fixture OAuth record;
- different synthetic OAuth credentials for Alpha and Beta.

Agent keys cannot call the credential-management route. The fixture server and
its tools are absent from the real workspace key.

The repeatable harness is `qualify-oauth-custody.mjs` with phases `setup`,
`verify-persisted`, `expiry-refresh`, and `revoke`.

## Evidence

| Probe | Result |
| --- | --- |
| Repository build and tests | 34/34 passed |
| Dedicated stable `LITELLM_SALT_KEY` | Present; separate from master key |
| LiteLLM PostgreSQL storage | Named persistent volume, not `tmpfs` |
| At-rest synthetic credentials | 2 rows / 2 users; minimum ciphertext length 348; plaintext marker absent |
| Same user, two agents | Both resolved Alpha's credential |
| Per-agent tool policy | Research and Calendar keys could use only their distinct assigned tool |
| Cross-user isolation | Beta resolved a different credential fingerprint |
| Missing user credential | Denied before an authenticated fixture call |
| Agent credential management | Denied with 403 |
| Existing key with mismatched identity | Adapter deletes and recreates it; vendor update is not trusted to change identity |
| Database plus LiteLLM restart | Keys and encrypted credentials remained usable and isolated |
| Expired credential without refresh | Denied |
| Refresh-token flow | Refreshed through the configured token endpoint; other user unaffected |
| User credential revocation | Both Alpha agents denied; Beta remained usable |
| Agent-key revocation | All deleted keys denied |
| Cleanup | Zero qualification credentials and zero qualification keys remained |
| Log scan | No synthetic access token, refresh token, or agent key markers found |
| Deployed workspace key | Non-null LiteLLM `user_id` and `agent_id` with product identity metadata |
| Workspace MCP discovery | Exactly `onecomputer_fixture/search_files`; OAuth fixture and M365 absent |
| Sandbox network | LiteLLM reachable; Softeria and Microsoft Graph direct routes blocked |
| Sandbox environment | Workspace key present; no LiteLLM master/salt or Microsoft credential present |

## Important findings and remaining blockers

1. The earlier interactive Microsoft connection did not survive the disposable
   LiteLLM database. Immediately before the persistent-volume migration the
   database contained zero `LiteLLM_MCPUserCredentials` rows. No surviving
   grant was destroyed by this qualification.
2. Chat -> Integration under the local LiteLLM administrator is not the product
   connection path. The next real Entra consent must be made under a narrow
   connection session whose LiteLLM `user_id` matches the ONEComputer user used
   by that user's agent keys.
3. ONEComputer does not yet provide the owned connection-session/callback UI.
   Until it does, a generic LiteLLM admin connection must not be assigned to a
   workspace.
4. Real Graph probes remain outstanding: bounded OneDrive search/read, bounded
   mail/calendar reads, wrong tenant/scope/resource behavior, throttling,
   timeout/provider errors, and a real-token leak scan.
5. Control now generates deterministic vendor user/agent identities and binds
   them to keys. These identifiers do not depend on the rotatable virtual-key
   credential secret, but durable owned agent records and the read-path policy
   hook are not yet implemented.
6. Process and database restarts passed. Backup/restore, database replacement,
   salt-loss recovery, and rotation procedures remain production work.

Issue 008 therefore remains `blocked`; the vendor credential-custody seam has
passed its synthetic gate, while the real identity-bound Microsoft slice has
not.
