# OneComputer E2E Demo Audit (2026-07-05)

Rigorous, honest audit of the 8-step investor/CEO demo flow against real code. Overall: **~38%**, not 5% — but the demo-critical path (real blocked action → real VTI-signed approval → real release) is mostly absent.

## Verdict by step

| Step                          | Verdict  | %   | Why                                                                                                                        |
| ----------------------------- | -------- | --- | -------------------------------------------------------------------------------------------------------------------------- |
| 1. Admin login                | PARTIAL  | 55  | Local auto-login `admin@localhost` by default; Entra SSO provisioned but not verified end-to-end                           |
| 2. Add users + set policy     | **REAL** | 75  | RBAC + policy rules work (members.ts, rules.ts); no real connector to target                                               |
| 3. Non-admin user login       | PARTIAL  | 45  | Local mode can't represent non-admin at all                                                                                |
| 4. User spins up sandbox      | **REAL** | 80  | Kasm + Daytona providers work; no `ownerId` on sandbox model                                                               |
| 5. SSH/Claude Code securely   | PARTIAL  | 55  | exec API works; no real SSH; Claude Code model calls not proven to route through gateway                                   |
| 6. Blocked → redirect to link | PARTIAL  | 50  | Gateway hold is REAL (forward.rs:362-540); no UI bridge, no real connector, stale "sim" labels in governed-action-card.tsx |
| 7. 2FA / step-up              | PARTIAL  | 45  | VTI envelopes + gateway hold real; delivery is local DB outbox, not a phone                                                |
| 8. Powered by VTI             | PARTIAL  | 35  | affinidi TDK signing is real (vti_signer.rs); manager approval has NO crypto signature (it's a DB row)                     |

## What's REAL (don't lose this)

- **Gateway policy enforcement**: `apps/gateway/src/policy.rs:104-150` — Block>ManualApproval>RateLimit>Allow with strictest-wins merge (commit 9e178ec, 7 matrix tests).
- **Mid-flight hold + poll**: `apps/gateway/src/gateway/forward.rs:362-540` builds PendingApproval, calls approval_notify, races watch-channel + HTTP poll (approval_poll.rs) — REAL, wired end-to-end.
- **VTI signing primitives**: `vti_signer.rs` uses real affinidi TDK (Ed25519 eddsa-jcs-2022) with passing sign/verify/tamper tests. No DIY crypto.
- **Identity injection**: `identity_injection.rs:870-884` injects a signed AgentIdentityCredential VP into MCP JSON-RPC responses on the live forward path.
- **Sandbox provision**: Kasm-local + Daytona providers both work; Azure sandbox03 has nested KVM for Cowork.
- **RBAC**: members.ts, rules.ts, sandboxes.ts all use `requireAbility` with real DB-backed ability checks.

## Biggest blockers (ranked)

1. **No real write-capable connector** (Outlook/SharePoint) — Step 6's "user tries to do stuff and gets blocked" has no real action to gate. Only a curl to graph.microsoft.com that 401s. → ONE-48
2. **VTI delivery is a local DB outbox** (`vti-outbox-local`) — "sent_to_vti_adapter" is a status string, not a transport. No signed manager response. → ONE-49, ONE-53
3. **Auth is local-admin auto-login by default** — admin@localhost, no password. Entra SSO provisioned but no end-to-end login (especially a second non-admin) verified. → ONE-50
4. **Manager approval has no cryptographic signature** — decideApproval writes a DB row; gateway reads "approved" and releases. "Powered by VTI" is a contract/seam, not a verified proof. → ONE-49
5. **Sandbox has no ownerId + Claude Code model calls bypass the gateway** — user in noVNC desktop escapes the policy layer. → ONE-52

## Highest-leverage path from 38% → 80%

1. **ONE real connector** (Outlook send via Graph) — unblocks Steps 6 + 7 with a real action to gate. (ONE-48)
2. **One end-to-end Entra login** as admin + second manager user — converts Steps 1 + 3 to REAL. (ONE-50)
3. **Wire the existing ManualApproval hold to a UI surface** + fix stale card copy — Step 6's enforcement is 90% built, just needs the UI bridge. (ONE-51)
4. **Sign the manager's approval decision with affinidi TDK** + verify in gateway — THE change that makes VTI "power" the approval. Difference between demo and pilot. (ONE-49)
5. **Add ownerId + force HTTPS_PROXY** so Claude Code's calls hit the policy layer. Closes the bypass. (ONE-52)

## Filed in Linear

ONE-48 (Outlook connector), ONE-49 (sign manager approval), ONE-50 (Entra E2E), ONE-51 (gateway-hold UI), ONE-52 (ownerId + HTTPS_PROXY), ONE-53 (real VTI delivery), ONE-54 (real signer).
