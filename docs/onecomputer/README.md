# OneComputer docs — what to read (2026-06-28)

> Start at [`AUDIT.md`](../../AUDIT.md) for verified ground truth. Most other
> historical docs in this tree have been compressed or removed because they were
> LLM-authored and overstated what works (notably the self-graded 95/100
> scorecards). This file tells you what survived and why.

## Read these (real content, kept)

- [`gap-inventory-and-build-plan.md`](gap-inventory-and-build-plan.md) — honestly
  says "readiness is 3/10." The product architecture sketch (builder UX + CISO UX)
  is still the right shape. (The "3/10" was a moment-in-time; AUDIT.md supersedes
  the number.)
- [`vti-affinidi-integration-seam-2026-06-21.md`](vti-affinidi-integration-seam-2026-06-21.md) —
  documents the verifier seam. Note: it admits `affinidi-vti` is a "mock sidecar"
  / generic HTTP fetch. Real Affinidi SDK not wired. The _contract_ here is still
  the intended boundary.
- [`rebrand-map.md`](rebrand-map.md) — OneCLI → OneComputer package-scope migration
  plan. Still valid.
- [`deploy-command-spec.md`](deploy-command-spec.md) — the `onecomputer deploy`
  wedge spec. Still the intended CLI shape.
- [`ciso-control-room.md`](ciso-control-room.md) — CISO console intent.
- [`gateway-hardening-runbook-2026-06-21.md`](gateway-hardening-runbook-2026-06-21.md) —
  documents the genuinely-real Rust gateway hardening.
- [`app-passport-and-vti-grant-schema-2026-06-21.md`](app-passport-and-vti-grant-schema-2026-06-21.md) —
  passport schema (the passport JSON itself is real and self-consistent).
- [`policy-artifacts-and-evidence-chain-2026-06-21.md`](policy-artifacts-and-evidence-chain-2026-06-21.md) —
  evidence hash-chain design (real in the access gateway; unsigned).
- The URL proofs (`governed-streamlit-url-proof`, `nodejs-dynamodb-url-proof`,
  `react-static-url-proof`) — real ECS Express deploys with real URLs. Kept.
- [`secure-cowork/`](secure-cowork/) — AppStream / Windows cloud-PC POC docs
  (describe real working POCs).

## Removed (slop)

- `vti-95-readiness-master-plan-2026-06-21.md` — the self-graded 95 program plan.
- `personal-connectors-95-master-plan-2026-06-22.md` — built on the self-graded 95.
- `ciso-50-readiness-proof-2026-06-21.md`, `ciso-50-review-gates-2026-06-21.md` —
  readiness-proofs inflated by self-report.
- `phase-1-wedge-demo.md`, `stakeholder-demo-runbook.md` — demo scripts for a
  build whose enforcement layer is simulator-only.
- `loop-engineering-study-2026-06-21.md`, `nodejs-simple-db-wedge-plan-2026-06-21.md` —
  superseded process notes.

## Compressed (slop → honest index)

- [`review-gates/README.md`](review-gates/README.md) — 47 phase checkpoints → 1 index with real status.
- [`pilot/README.md`](pilot/README.md) — 7 scorecard/evidence files → 1 honest summary.
- [`backlog/README.md`](backlog/README.md) — 9 scout/status files → 1 index of still-valid items.

## The honest score

Real working production-grade code is ~35-40% of what the "95/100" implied. The
author's own `vti95-state.json` admits an honest baseline of 25/100. See
[`AUDIT.md`](../../AUDIT.md) for the verified real-vs-vapor breakdown and the
TGW-recreation gap list.
