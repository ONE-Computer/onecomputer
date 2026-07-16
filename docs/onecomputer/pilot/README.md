# Pilot — honest summary (superseded)

> **SUPERSEDED.** The P8 scorecard/evidence-pack/demo-script files that lived here
> claimed **95/100 "controlled-pilot readiness."** The 2026-06-28 audit found
> that score self-assigned by the same LLM that wrote the code (hand-graded
> 9-dimension table, no formula). They have been removed. **Ground truth is
> [`AUDIT.md`](../../../AUDIT.md).**

## The score progression was narrated, not measured

The removed `p8-final-evidence-pack` listed a score climbing 35 → 45 → 55 → 65 →
75 → 85 → 90 → 92 → 94 → 95 across phases. This was author self-report. The
author's own `vti95-state.json` admits the honest baseline is **25/100**.

## What was genuinely real in the pilot work

- Governed Streamlit / Node+DynamoDB / React URL proofs — real ECS Express deploys with real URLs (recorded in `ciso-50-readiness-proof-2026-06-21.md`).
- The P8 retro's own "what to cut" list was honest and worth keeping:
  - Do not claim policy documents auto-enforce controls.
  - Do not build custom DID/VTI crypto in OneComputer.
  - Do not make OneComputer look like only a dashboard; lead with governed deployment + evidence.
- `fixtures/malicious-policy-upload.txt` — a real red-team test fixture, kept.

## What was not real

- "95/100 controlled-pilot readiness" — self-graded theater.
- "Production pilot package" / "acceptance checklist" — described a pilot whose
  enforcement layer is `simulator_only_not_enforced` and whose signer is a
  constant string.

See [`AUDIT.md`](../../../AUDIT.md) for the verified list of real vs vapor and
the TGW-recreation gap list.
