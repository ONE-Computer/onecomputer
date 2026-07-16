---
name: loop-budget
description: Check token budget and spend before and after a loop run. Enforces early exit when over budget or when there is no actionable work.
---

# Loop Budget Guard

Run at the **start** and **end** of every loop iteration.

> **2026-06-28 note:** This skill previously read `loop-budget.md` and
> `loop-run-log.md`, which were removed as slop. It is now self-contained. There
> is no longer a fictional "readiness score" to advance — see `AUDIT.md`.

## Start of run

1. Read `STATE.md` for the real priority list (no score to move).
2. If `loop-pause-all` appears in `STATE.md` → **exit immediately** with a one-line note.
3. If the state has no actionable items → **exit in <5k tokens** (do not spawn sub-agents).
4. Enforce a per-run cap (default: ~50k tokens, or the value the runner was given). If already near it, **report-only mode** (no sub-agents, no auto-fix).

## End of run

Append one JSON object to a run log (in-memory or the runner's own log — not a repo file unless the runner owns it):

```json
{
  "run_id": "<ISO8601>",
  "slice": "<what was attempted>",
  "verified_working": <true|false>,
  "actions_taken": <number>,
  "tokens_estimate": <number>,
  "outcome": "no-op | report-only | fix-proposed | escalated"
}
```

## Rules

- A slice is "done" only when a test that **asserts** behavior runs in CI and the change is wired to a real enforcement path. Do NOT declare done on a `simulator_only` preview.
- High-cadence patterns **must** early-exit when nothing is actionable.
- Never exceed the per-run sub-agent spawn cap.
- Do not print secrets. No DIY crypto.
