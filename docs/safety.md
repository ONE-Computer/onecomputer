# OneComputer Loop Safety Policy

Date: 2026-06-21

## Default posture

OneComputer loops are assisted, not unattended. They can propose, implement bounded slices, run tests, commit locally, and report. They cannot merge, push, expose secrets, or broaden production access without human approval.

## Denylist for automatic edits

Do not auto-edit without explicit human approval:

```text
.env
.env.*
**/secrets/**
**/credentials/**
**/*_key*
**/*_secret*
.terraform/**
k8s/production/**
**/migrations/**
auth/**
payments/**
billing/**
```

## Human gates

Require human review for:

- authentication and authorization changes;
- credentials, IAM, KMS, Secrets Manager, or connector scopes;
- PII/personal connector write access;
- billing/payment flows;
- production infrastructure;
- dependency upgrades;
- changes touching more than 10 non-doc/test files;
- third failed attempt on the same issue.

## Secret handling

- Never paste API keys into prompts, docs, memory, screenshots, or logs.
- Use `onecli-managed` or runtime injection placeholders.
- Scrub grant/origin/admin tokens from evidence packs.
- Do not publish raw AppStream command screenshots if they include presigned URLs.

## Auto-merge policy

No auto-merge. No remote push unless Terence explicitly requests it.

## Incident response

If a loop makes a bad change:

1. Set `loop-pause-all` in `STATE.md`.
2. Stop/pause scheduled task if needed.
3. Revert local commit or create a corrective commit.
4. Add a review-gate note explaining failure and new guardrail.
