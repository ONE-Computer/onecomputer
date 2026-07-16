# ONEComputer repository and runtime boundary

This is the source-of-truth boundary for the Azure deployment and for CI/CD.
Cloning a repository for study does not make it part of the ONEComputer
production build. A repository is only a production input when it is either:

1. in the ONEComputer workspace;
2. declared as a pinned package or Cargo dependency; or
3. explicitly named as an independently deployed OpenVTC/VTI service.

## North-star topology

```text
User browser
    |
    v
Azure Nginx -> ONEComputer web/API (Next.js, systemd)
                      |
                      +--> PostgreSQL (state, policy, audit)
                      +--> Rust policy gateway (systemd)
                      +--> Kasm sandbox -> LiteLLM / Presidio
                      |
                      +--> OpenVTC/VTI trust plane
                           (VTA wallet, DIDComm/TSP, trust registry)

Gitea merge -> Gitea Actions -> Azure runner -> verified release -> health gate
```

ONEComputer is the business application and enforcement edge. VTA/VTI owns
wallet key custody, DIDComm/TSP delivery, identity proof, and the cryptographic
approval. The portal may display a request and its status, but it is not an
approval authority.

## Repository classification

| Repository / directory                                                                                                        | Role                                                                  |                       Build in ONEComputer CI? |                                   Host as an Azure service? | Rule                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------: | ----------------------------------------------------------: | ---------------------------------------------------------------------------------------- |
| `onecli/onecomputer` (this repo)                                                                                              | Production application, gateway, migrations, deployment and E2E tests |                                            Yes |                                                         Yes | Only production application repository today                                             |
| `apps/web`                                                                                                                    | Next.js portal and server routes                                      |                                            Yes |                              Yes, `onecomputer-web.service` | Build once per release; no separate repo                                                 |
| `packages/api`                                                                                                                | API/business services imported by the web app                         |                 Yes, as a workspace dependency |                                                          No | Not a separately hosted API process                                                      |
| `packages/db`                                                                                                                 | Prisma client, schema and migrations                                  |                                            Yes |                         PostgreSQL is hosted; Prisma is not | Run migrations as a guarded release step                                                 |
| `packages/ui`, `packages/eslint-config`, `packages/typescript-config`                                                         | Workspace libraries/tooling                                           |                          Yes, where referenced |                                                          No | Bundled or developer/CI-only                                                             |
| `apps/gateway`                                                                                                                | Rust policy, interception, approval and credential gateway            |                                            Yes |                          Yes, `onecomputer-gateway.service` | Produce a release binary                                                                 |
| `docker/`, `deploy/`, `scripts/onecomputer/`                                                                                  | Runtime, systemd, Nginx, E2E and operational tooling                  |                                 Validate in CI | Nginx, PostgreSQL, Kasm, LiteLLM and Presidio as configured | Operational code is versioned with the app                                               |
| `affinidi-tdk-rs`                                                                                                             | Affinidi Rust cryptography/DID/VTI libraries                          |         Only the pinned crates pulled by Cargo |                                                          No | Current Cargo source is a pinned Gitea commit; never use a sibling path                  |
| `@openvtc/rp-sdk` (`rp-sdk-js`)                                                                                               | Relying-party login verification SDK                                  |              Yes, through the package lockfile |                                                          No | Import the released package; do not host the SDK                                         |
| `dtgwg-trust-tasks-tf`                                                                                                        | Normative Trust Task specifications and schemas                       |       Only pinned schemas/fixtures when needed |                                                          No | Treat as a specification registry, not an app service                                    |
| `openvtc`                                                                                                                     | OpenVTC CLI and core wallet tooling                                   | No, unless a workflow explicitly tests the CLI |                                                          No | Useful developer/manager tool; not part of the portal runtime                            |
| `verifiable-trust-infrastructure`                                                                                             | VTA/VTC/VTI services, SDKs, wallet and enclave crates                 |                       No whole-workspace build |                                               No by default | Integrate at a documented API/protocol seam; deploy only with explicit OpenVTC ownership |
| `vta-browser-plugin`, `vta-mobile-agent-ios`                                                                                  | Separate manager wallet clients                                       |                 Separate client CI when needed |                                                          No | Approval must stay outside the ONEComputer web UI                                        |
| `vti-didcomm-js`, `vti-push-gateway`                                                                                          | DIDComm/push transport components                                     |                                  No by default |                                               No by default | Consume the OpenVTC transport; do not fork a local notification authority                |
| `vti-setup`                                                                                                                   | VTA/DIDComm deployment recipes                                        |                                             No |                                                          No | Reference for the OpenVTC/VTI environment owner                                          |
| `governance`                                                                                                                  | OpenVTC organization configuration                                    |                                             No |                                                          No | Organization infrastructure, outside the app release                                     |
| `onecomputer`, `onecomputer-secure-claude-computer-poc`, `onecomputer-appstream-linux-ssh`, `onecomputer-windows-experiments` | Older implementations, experiments and platform prototypes            |                                             No |                                                          No | Study or mine selectively; do not add to production CI                                   |
| `daytona-oss`, `graphify`, `dom-to-pptx`, `pptxgenjs`, `tgw-reference`                                                        | Optional integrations, experiments or general-purpose tooling         |                  No unless explicitly imported |                                                          No | A clone alone is not a deployment dependency                                             |

## What Azure runs today

The current Azure VM runs the following runtime components:

- `onecomputer-web.service`: the built Next.js portal/API;
- `onecomputer-gateway.service`: the Rust policy gateway;
- PostgreSQL for application state and audit records;
- Kasm desktop/sandbox containers for the user workspace;
- LiteLLM and Presidio sidecars used by the sandbox path;
- Nginx for the public TLS/reverse-proxy edge.

The OpenVTC/VTI trust plane is an external security boundary. The current
ONEComputer code emits the canonical Trust Task and verifies the signed
response, but its local `vti-outbox-local` adapter is still a compatibility
harness. Production readiness requires a real VTA wallet plus DIDComm/TSP
delivery and an agreed service owner before those services are added to Azure.

## Dependency rules

- No absolute sibling-repository paths in production manifests.
- Every external package or Cargo dependency is pinned by a lockfile and/or
  immutable version/commit.
- A cloned OpenVTC repository is studied locally; it is not copied into the
  ONEComputer image unless the code is deliberately adopted and reviewed.
- CI builds only this workspace and its declared dependency graph. It does not
  recursively build `../openvtc/*` or every repository under the project folder.
- OpenVTC protocol schemas are versioned in the Trust Task registry and checked
  as contract fixtures. Business policy remains in ONEComputer; cryptographic
  identity and approval remain in VTA/VTI.

## CI/CD boundary

Gitea is the source control system for this deployment. Gitea Actions is the
orchestrator, with an Azure self-hosted runner split into two labels:

- `onecomputer-ci`: pull-request validation with no production credentials;
- `onecomputer-deploy`: merge-to-`main` deployment with a narrowly scoped
  `sudo` wrapper and access to the production `.env`.

The deploy job is intentionally gated by a successful verification job and a
`main` merge. It checks out the exact merge commit, builds the declared web and
gateway targets, runs migrations, restarts the systemd units, and fails on
health checks. Until real VTA/DIDComm delivery is wired, this pipeline deploys
the verified ONEComputer release but does not claim the complete investor E2E.

The deployment runner must be registered as a dedicated, non-shared Gitea
Actions runner. Pull-request jobs must never receive the `onecomputer-deploy`
label or production environment. The allowlisted `/usr/local/sbin/onecomputer-deploy`
wrapper accepts only a 40-character commit SHA and runs the checkout deployment
as `azureuser`; the checkout's deploy script rolls the application checkout back
if build or health checks fail. Database migrations remain forward-only: a
failed migration is a release failure to investigate, not an automatic schema
downgrade. The branch-based deployment script remains an explicit operator
runbook path, not the automated sudo entry point.

The repeatable Azure bootstrap is
`sudo bash scripts/onecomputer/provision-gitea-runner.sh`. It installs the
pinned `act_runner` binary extracted from its pinned container digest, registers
the runner against the VM-local Gitea, and installs the systemd/sudoers
allowlist. The runner has Docker access for CI containers; this is why it is a
dedicated VM runner and why no untrusted pull-request job is given the deploy
label. A loopback-only Gitea bridge is exposed only on Docker's host gateway
interface so containerized CI can fetch the pinned Cargo mirror without making
Gitea public.
