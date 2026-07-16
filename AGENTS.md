# OneComputer Agent Instructions

OneComputer is a governed AI-computer runtime control plane for enterprise CISO / digital-transformation buyers. It began as a OneCLI fork but must evolve into a platform for governed AI computers, agents, and vibe-coded apps.

## Read first

Before changing governance, identity, policy, approvals, VTI, connectors, or CISO dashboard code, read:

1. [`AUDIT.md`](./AUDIT.md) — verified real-vs-vapor status (2026-06-28). **Many "complete / 95 / ready" claims elsewhere are theater.**
2. `CLAUDE.md`
3. `STATE.md` — honest priorities, not the old phase ladder.

(Old pointers to `vti-95-readiness-master-plan` and `p8-final-95-scorecard` were removed — those docs were self-graded slop. The verified research deep-study at `docs/onecomputer/research/vti-openvtc-guardrails-deep-study-2026-06-22.md` and the backlog index at `docs/onecomputer/backlog/README.md` are still worth reading.)

## Current direction

The north star is **ONEComputer as a thin business/control layer on OpenVTC**:
an admin configures company policy, an employee launches a governed sandbox and
uses Claude, a risky Outlook action is held by the ONEComputer gateway, and a
manager approves or denies the exact action in a separate OpenVTC/VTI Wallet.
The wallet proof—not a ONEComputer web button, localStorage key, Entra MFA
prompt, or gateway-generated signature—is the approval authority.

The implementation sequence is NORTH-0 through NORTH-6: OpenVTC identity and
session foundation; VMC/M-DID role authority; branch/repository reconciliation;
load-bearing gateway verification; live wallet approval; TSP-first/DIDComm
delivery; and cross-repository protocol conformance. Read
[`docs/onecomputer/repo-and-runtime-boundary.md`](./docs/onecomputer/repo-and-runtime-boundary.md)
before cloning, vendoring, or adding an OpenVTC dependency.

The older P9 Guardrails Runtime Controls work remains relevant only where it
directly enables that north-star E2E. Do not let the old phase ladder or a large
generic backlog displace the OpenVTC approval path.

Do not treat “policy engine” as only compliance-document ingestion. The real product is protective runtime enforcement:

- external email requires 2FA/approval;
- file reads have rate limits;
- recursive delete is denied or approval-gated;
- secret release requires step-up and TTL;
- inbound connectors are default-deny until consent;
- policy weakening requires cyber approval.

## VTI/OpenVTC doctrine

Use Affinidi/OpenVTC/VTI wherever possible:

- VTA/VTC for DIDs, keys, credentials, access-control, trust communities;
- Trust Tasks for action/approval/consent/policy/vault/evidence messages;
- DIDComm as preferred transport;
- VTA mobile/browser agents for biometric/passkey step-up and approvals;
- WebVH/DID hosting for production-resolvable identities.

Do **not** build custom crypto, custom DIDComm, custom wallet key storage, or custom 2FA if an Affinidi/OpenVTC SDK/spec can be used.

For the Azure staging E2E, the canonical approval path is the hosted
`openvtc-wallet` CLI/service plus `openvtc-didcomm-bridge`; the portal must not
gain an approval endpoint. Gateway-created holds automatically dispatch a
Trust Task when `OPENVTC_TRANSPORT_BINDING=didcomm`, and the separate wallet
CLI is the only approval action. The reusable
`packages/api/src/scripts/provision-staging-graph-connection.ts` script stores
the short-lived Graph token encrypted as an AppConnection and attaches it to
the demo default agent. Never copy that token or any wallet/VTA material into
a sandbox, checkout, ticket, or log. Treat the staging mediator's open/direct
delivery and plaintext VTA seed as promotion blockers, not production defaults.

The cloned `openvtc/vta-mobile-agent-ios` app is the preferred human wallet
surface, but verify its wire boundary before connecting it: the current app
expects a bare VTA `auth/step-up` body and posts the signed response to the VTA,
while ONEComputer staging currently wraps the canonical document and accepts
the signed response at its approval endpoint. Integrate this with a thin
adapter that preserves the OpenVTC Trust Task and Keychain custody; do not
fork a second approval protocol or silently point the app at the VTA and call
the E2E complete. See
[`docs/onecomputer/openvtc-ios-wallet-setup.md`](./docs/onecomputer/openvtc-ios-wallet-setup.md).

## GitHub repository policy

The GitHub organization is `ONE-Computer`. The canonical public product repo
is [`ONE-Computer/onecomputer`](https://github.com/ONE-Computer/onecomputer),
and the public architecture site is
[`one-computer.github.io`](https://one-computer.github.io/). The repository
boundary and history rules are in
[`docs/onecomputer/github-repository-strategy.md`](./docs/onecomputer/github-repository-strategy.md).

Preserve upstream history in OpenVTC forks. Do not force-push a fork to make
commit messages look cleaner. For the ONEComputer product, publish only a
secret-scanned, curated tree; keep internal Gitea history and operational
artifacts out of the public repository. Never bypass GitHub Push Protection.

## Policy merge rule

Governance can make agents safer or deny actions. Users can make their own agents safer. Users cannot make agents more powerful than global governance allows.

Strictest-wins order:

1. Global cyber/governance deny.
2. Global cyber/governance floor.
3. Department/project/data policy.
4. Personal owner policy.
5. Runtime anomaly/rate-limit policy.
6. If approval/step-up cannot be resolved, fail closed.

## Coding standards

Follow `CLAUDE.md` for TypeScript, UI, audit, deployment, and VTI rules. Keep changes small, tested, and documented. Update `docs/onecomputer/` and review gates when adding governance features.

For Kasm/Daytona sandbox work, keep the runtime boundary explicit: model
traffic may use the local LiteLLM loopback, but employee outbound traffic must
be configured with the agent-scoped OneComputer gateway proxy and gateway CA.
Never ship a sandbox that can reach Outlook or another governed connector
directly. Verify the sandbox's Claude command path and a real gateway request,
not only the desktop/VNC health flag.

## Linear board operating rules

Linear is the source of truth for execution tracking. The ONEComputer team is
`ONE`; the primary project is **ONEComputer × OpenVTC North Star**. The full
workflow and current milestone map are documented in
[`docs/onecomputer/linear-board-operations.md`](./docs/onecomputer/linear-board-operations.md).

When Linear API access is needed, read the local credential at
`../handover/onecomputer-handover-secrets-lean/mac/linear-api-key.txt` only into
an in-memory shell variable and send it as the `Authorization` header to
`https://api.linear.app/graphql`. Never print the key, put it in a command
argument visible in logs, commit it, copy it into `.env`, or paste it into a
ticket/comment. If the file is absent, ask for access; do not create a new key
or use a browser session as a workaround.

Before changing tickets:

1. Query the ONE team, workflow states, projects, and all active issues. Group
   by north-star dependency, project, state, and priority; do not blindly
   rewrite the whole board.
2. Keep one canonical ticket per deliverable. If an issue is an exact duplicate
   or superseded placeholder, add a short successor comment and move it to
   `Canceled`/`Duplicate`; do not delete it or silently erase its history.
3. Put implementation detail in the description: repository/file boundary,
   protocol or API contract, security invariants, acceptance tests, evidence
   required, dependencies, and explicit non-goals.
4. Keep `Urgent` for the current critical path, `High` for the next gate, and
   `Medium` for post-E2E or non-blocking work. Never mark work `Done` from a
   fixture, UI-only state, skipped test, or self-authored claim.
5. After a material code slice, update the relevant ticket with the commit SHA,
   checks run, runtime evidence, and remaining blocker. Keep the board and
   repository docs consistent before handing off.

## UX standards

CISO/admin UX should sound like security operations tooling (CrowdStrike/Palantir-style clarity), not sales copy. Prefer concrete controls, evidence, owners, risk states, and next actions.

When changing frontend screens, capture screenshots and include them in progress updates where possible.

## Background loop / scheduler learnings

When running long OneComputer work through NanoClaw scheduled tasks:

- Keep the scheduled prompt tiny. Do **not** paste the whole roadmap, state JSON, validation matrix, and scripts into the scheduler prompt.
- Put durable loop instructions on disk, currently `.onecomputer/background/personal-connectors-loop-instructions.md`, and make the scheduled task a short bootstrap that reads that file.
- The scheduler core was verified with minimal one-shot and recurring probes. If a OneComputer loop does not run, suspect prompt/task payload complexity before blaming cron.
- Required loop contract:
  1. send Terence a pre-loop message before repo work;
  2. execute exactly one small slice;
  3. run/record review gates;
  4. run validation checks;
  5. update state/docs/memory;
  6. commit coherent changes;
  7. send a post-loop update with score, gates, checks, commit, blockers, and screenshots if UI changed.
- Prefer one small phase slice per loop. If a loop cannot finish inside the turn budget, stop with a clear blocker and do not pretend progress.
