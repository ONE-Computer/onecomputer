# Linear board operations

This document is the durable operating guide for agents working on the
ONEComputer Linear board. It exists because the board contains useful history,
old demo work, and superseded VTI experiments alongside the current OpenVTC
north-star path.

## Access without leaking credentials

The local handover stores the Linear personal API key at:

```text
../handover/onecomputer-handover-secrets-lean/mac/linear-api-key.txt
```

Use it only as a shell variable or process environment value. For example:

```bash
KEY_FILE="../handover/onecomputer-handover-secrets-lean/mac/linear-api-key.txt"
LINEAR_API_KEY="$(<"$KEY_FILE")"
curl -sS https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @query.json
unset LINEAR_API_KEY
```

Do not print the variable, include it in a URL, put it in a repository `.env`,
commit it, or paste it into an issue. Do not use `set -x`. If the key is
missing, stop and request access.

## Board model

Team: `ONE` / ONEComputer.

Primary project: **ONEComputer × OpenVTC North Star**.

Milestone order:

| Milestone | Outcome                                                                         | Typical owner boundary                            |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| NORTH-0   | OpenVTC-native login/session; no Entra/local persona as production authority    | `apps/web`, API auth adapter, OpenVTC RP contract |
| NORTH-0a  | Membership and roles derived from VMC/M-DID/VTC claims                          | API authorization projection, VTI/VTC verifier    |
| NORTH-1   | One reconciled integration line and pinned upstream dependency boundaries       | Git/Gitea, workspace packages, CI                 |
| NORTH-2   | Manager proof is independently verified and load-bearing before gateway release | API + `apps/gateway`                              |
| NORTH-3   | A real external wallet signs the exact held action                              | OpenVTC wallet/PWA/VTA boundary + E2E harness     |
| NORTH-4   | Trust Task delivery is TSP-first, DIDComm fallback, contentless push wake       | OpenVTC adapter, mediator, `vti-push-gateway`     |
| NORTH-4a  | Actor AAL2 is separate from manager action approval                             | API/UI/VTA flows                                  |
| NORTH-5   | Enterprise manager authority comes from verified trust credentials              | VMC/M-DID/VTC claims and revocation               |
| NORTH-6   | Protocol/package/fixture interoperability is pinned and tested across repos     | ONEComputer + OpenVTC repos and CI                |

The business acceptance path is: admin login → company policy → employee login
→ sandbox → Claude action → gateway hold → external VTI alert → manager wallet
decision → proof verification → exactly-once release. Anything that does not
advance or protect this path is secondary until the E2E gate is green.

## Ticket hygiene

Before editing, query active issues and inspect title, description, state,
priority, project, parent, labels, and recent comments. Then:

- Keep a single canonical ticket for each deliverable.
- Use `Canceled` or `Duplicate` with a successor comment for exact duplicates or
  replaced placeholders; never delete issue history.
- Use `Urgent` only for the current release-critical dependency, `High` for the
  next gate, and `Medium` for post-E2E work.
- Put technical depth in descriptions: repo/file boundary, OpenVTC contract,
  security invariants, failure modes, acceptance tests, evidence, dependencies,
  and non-goals.
- Do not mark `Done` for a fixture-only path, a UI-only button, a skipped test,
  a local simulation presented as delivery, or an unverified manual assertion.
- After a code slice, comment the exact commit SHA, commands/tests, runtime
  evidence, and remaining blocker. If work is deployed, include the deployed
  SHA and health check; do not claim CD ran before a merge to `main`.

## Repository boundary language

Ticket descriptions must distinguish:

1. ONEComputer production code that is built and hosted.
2. Workspace packages that are built only when imported by ONEComputer.
3. Pinned upstream packages/crates used as dependencies.
4. Separately hosted OpenVTC/VTI services such as VTA, mediator, and push
   gateway.
5. Cloned source/reference/prototype repositories that are studied or used for
   fixtures, not silently shipped as part of the app.

The canonical boundary is maintained in
[`repo-and-runtime-boundary.md`](./repo-and-runtime-boundary.md).
