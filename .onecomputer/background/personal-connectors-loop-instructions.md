# OneComputer Background Loop Instructions

Repo: `/workspace/agent/implementation/onecomputer`
Branch: `feature/onecomputer-phase1-rebrand`

> **2026-06-28 audit:** The prior "VTI 95-readiness" program and its self-graded
> 95/100 score have been superseded. **Do NOT advance a `currentEnterpriseCisoScore`
> number or claim "95/100 ready."** The score was self-assigned theater; honest
> baseline is ~25/100, real working code ~35-40%. Read [`AUDIT.md`](../../AUDIT.md)
> for verified ground truth before doing anything.

## Ground truth (read first)

- `AUDIT.md` (repo root) — verified real vs vapor, TGW-recreation gap list.
- `docs/onecomputer/README.md` — what docs survived the compression.
- `docs/onecomputer/backlog/README.md` — still-valid backlog items.

## Required communication

1. Before repo work, send Terence a pre-loop message in `giniclaw-secure-chat`:
   `Starting OneComputer loop: <slice>. Honest readiness ~25/100 (not 95).`
2. After work, send Terence a concise progress update: slice done, what was
   verified to actually work (test asserted + ran in CI), commit, blockers.

## Execution rules

- Read `AUDIT.md` and the backlog index before doing anything.
- Execute the smallest coherent slice only.
- **Real priorities (from the audit), not the old P1-P7 phase ladder:**
  1. Wire behavioral policy conditions / Rego eval (today `matches()` returns `true`).
  2. MCP/A2A JSON-RPC parsers + per-tool policies in the gateway.
  3. Prometheus `/metrics` endpoint.
  4. Source auth (API key + JWT/JWKS) per channel.
  5. Daytona/E2B adapter on the AppStream POC pattern.
  6. DID + VP issuance (use a vetted SDK / real VTI — NO DIY crypto).
- A feature is "done" only when it has a test that **asserts** behavior (runs in
  CI, not skipped), is exercised through a real enforcement path (not
  `simulator_only`), and uses a vetted SDK/external signer for crypto. Otherwise
  call it `preview` / `scaffold` / `contract`.
- Do not print secrets. Avoid DIY VTI crypto.