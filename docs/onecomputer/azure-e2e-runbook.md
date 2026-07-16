# ONEComputer × OpenVTC Azure E2E runbook

## Acceptance target

The release candidate is complete only when one recorded Azure run proves:

1. A company admin configures an organization-wide `manual_approval` policy for
   `POST graph.microsoft.com/v1.0/me/sendMail`.
2. An employee creates and opens their own Kasm sandbox.
3. Claude initiates the governed Outlook action through the ONEComputer gateway.
4. The gateway holds the HTTP request and creates a durable approval record.
5. OpenVTC alerts the manager with the action digest and human-readable preview.
6. OpenVTC delivers the manager an `auth/step-up/approve-request/0.1` through
   the configured TSP/DIDComm transport; the separate wallet signs
   `auth/step-up/approve-response/0.2` with the manager's key.
7. ONEComputer verifies the signed response, delegated manager authorization,
   exact subject/session/challenge/recipient binding, and the gateway releases
   the request once.
8. Unsigned, stale, altered, denied, timed-out, and replayed responses do not run.

## Promotion path

Code moves through these gates in order:

```text
local branch -> local tests -> local runtime E2E -> Gitea -> CI -> Azure deploy -> Azure E2E
```

The Azure VM must deploy a specific green Git commit. Editing application source
directly on the VM is not a deployment method.

## Sandbox lifecycle gate

`POST /v1/sandboxes` must return a tenant-owned sandbox ID in `provisioning`
state before optional desktop or Claude bootstrap begins. The API persists that
row first, then performs bootstrap asynchronously and updates it to `started`
or `failed`. A caller must be able to use `DELETE /v1/sandboxes/:id` while
bootstrap is running; deletion must be idempotent and remove the provider
container plus the persisted row. Bootstrap failure must trigger the same
provider cleanup before the row is marked `failed`.

Before a release can use the sandbox path as evidence, run both:

1. normal create → `provisioning` → `started` → exec → delete; and
2. create → immediate delete during bootstrap → no surviving container,
   bootstrap process, or sandbox row.

Do not accept a manually removed container, an empty provider list without a
matching ownership-row check, or a UI-only status as lifecycle proof.

## Azure source deployment

- portal: `https://onecomputer-openvtc.eastus2.cloudapp.azure.com`
- internal portal/API: `http://127.0.0.1:10254`
- internal gateway: `http://127.0.0.1:10255`

The public origin terminates TLS in nginx. HTTP redirects to HTTPS. The
approval device is an external OpenVTC wallet/VTA surface; the ONEComputer
portal is read-only for approval status. The certificate is managed by the
VM's Certbot systemd timer.

Deploy the Gitea branch and run the hosted trust-loop gate:

```bash
bash scripts/onecomputer/deploy-azure-vm.sh codex/azure-e2e-openvtc
GATEWAY_API_URL=http://127.0.0.1:10255 \
  pnpm exec dotenv -e .env -- \
  pnpm --filter @onecli/api e2e:openvtc-release
```

To execute the approved action against Microsoft Graph (this sends a real proof
email to the configured tenant recipient), add `E2E_GRAPH_LIVE=1`. A passing
live run ends with `upstream: "microsoft-graph"` and `upstreamStatus: 202`.

### Azure OpenVTC DIDComm wallet gate

The Azure staging VM now runs a separate OpenVTC manager wallet service and a
separate DIDComm bridge. The manager private material is outside the
ONEComputer checkout and the portal has no approval endpoint. The release gate
uses the deployed wallet service, not the older in-process test-wallet fixture:

```bash
sudo bash -c 'set -a; source /etc/openvtc/wallet.env; set +a
runuser -u azureuser -- /opt/node22/bin/node \
  /home/azureuser/work/onecomputer/packages/api/node_modules/.bin/tsx \
  /home/azureuser/work/onecomputer/packages/api/src/scripts/e2e-openvtc-didcomm-release.ts'
```

The staging mediator uses authenticated DIDComm direct delivery because the
pinned mediator build does not implement coordinate mediation and the existing
manager account lacks the forwarded-message ACL. The wallet and bridge skip
enrollment in staging. This is a development-only posture; the promotion gate
remains a closed mediator with explicit ACL/keylist provisioning and forwarded
delivery.

For the hosted Claude run, provision the short-lived Graph AppConnection from
the VM's Azure app credentials. The script encrypts the acquired token with
`SECRET_ENCRYPTION_KEY`, attaches it to the default employee agent, and never
prints or copies the token:

```bash
cd /home/azureuser/work/onecomputer/packages/api
set -a; source ../../.env; set +a
/opt/node22/bin/node node_modules/tsx/dist/cli.mjs \
  src/scripts/provision-staging-graph-connection.ts
```

Gateway-created holds automatically dispatch their OpenVTC Trust Task when
`OPENVTC_TRANSPORT_BINDING=didcomm`; no manager action in the ONEComputer UI or
manual notification POST is part of the acceptance path. The explicit wallet
CLI remains the only approval action:

```bash
sudo bash -c 'set -a; source /etc/openvtc/wallet.env; set +a
runuser -u azureuser -- /opt/node22/bin/node \
  /usr/local/lib/openvtc/openvtc-wallet.mjs approve <approval-id>'
```

The legacy standalone wallet fixture below is retained only for local protocol
diagnostics and must not be presented as evidence of the Azure OpenVTC path.

Start it on the VM using the API workspace:

```bash
OPENVTC_TEST_WALLET_PORT=18100 \
OPENVTC_TEST_WALLET_SEED_FILE=/run/user/$UID/onecomputer-test-wallet.seed \
OPENVTC_APPROVAL_API_URL=http://127.0.0.1:10254/v1/openvtc-approvals \
pnpm --filter @onecli/api wallet:openvtc-test
```

Generate the seed file with mode `0600`, keep it outside Git, and delete it
after the run. Do not pass a manager seed in a command-line argument or commit
it to the VM checkout.

Before starting ONEComputer for the gate, configure the printed wallet DID as
`OPENVTC_APPROVER_DID`, set `OPENVTC_TRANSPORT_BINDING=rest`, and point
`OPENVTC_TASK_ENDPOINT_URL` at `http://127.0.0.1:18100/trust-tasks`. Restart
the web and gateway services together so the API and gateway use the same
`OPENVTC_RP_DID` and approver configuration. The E2E harness then:

1. creates the real gateway hold;
2. queues the RP-signed request to the separate wallet process;
3. asserts the wallet received the alert and exact manager target;
4. submits an unsigned response and expects rejection;
5. calls the wallet's explicit `/approve/<approval-id>` endpoint;
6. waits for the gateway to release the controlled upstream or Graph request;
7. calls the wallet approval again and expects replay rejection.

This proves the Azure hold → external wallet → signed response → one-time
release boundary. The promotion gate is not complete until the same contract is
run through the real OpenVTC VTA/mediator/TSP-or-DIDComm transport and the
fixture is removed from the production path.

The service runtime reads root `.env`; the Next.js build also reads
`apps/web/.env.local`. `AUTH_URL`, `NEXTAUTH_URL`, and `PUBLIC_WEB_ORIGIN` must
all use the public HTTPS origin in the deployed environment.

Kasm desktops bind noVNC to loopback. Deployment renders TLS nginx bridges for
ports `16901` through `16910`; keep the Azure NSG and UFW range aligned. The
`onecomputer-litellm-bridge` service exposes the host-only LiteLLM listener on
the Docker bridge only, allowing `host.docker.internal` from sandbox containers
without publishing the model service to the internet.

The hosted seed currently pre-provisions the migration-harness identities into
Demo Corp. On first SSO session, the account's immutable subject replaces the
placeholder external ID while its intended org role is retained.

Entra remains a temporary migration harness. It must not be treated as the
OpenVTC approval authority or as a substitute for the separate wallet. The
production E2E requires a manager DID with VMC/M-DID/trust-registry
authorization and an external OpenVTC wallet/VTA key.

## Recorded browser acceptance run

Use the public HTTPS portal and real Entra identities in this order:

1. Sign in as `demo.admin@giniresearch.onmicrosoft.com`; in the organization
   policy view configure a company-wide `manual_approval` rule for `POST`
   `graph.microsoft.com` `sendMail`.
2. Sign in as `demo.member@giniresearch.onmicrosoft.com`; open the employee's
   `alex-azure-e2e` Kasm desktop and invoke the governed Outlook-send action
   from Claude. Record the sandbox ID and newly-created approval ID.
3. The manager's separate OpenVTC wallet/VTA receives the signed
   `approve-request`, verifies the RP proof, displays the action, and signs the
   canonical `approve-response/0.2`. The ONEComputer portal only displays the
   resulting status; it cannot approve the action.
4. Confirm the held request is released once, Graph returns `202`, the approval
   shows verified evidence, and a second approval attempt is rejected.

The current Azure evidence confirms the sandbox has Claude Code `2.1.207`, a
working authenticated LiteLLM model catalog, and a valid public TLS desktop
endpoint. The manager/employee phone enrollments are intentionally the last
interactive prerequisite.

The Azure feature branch contains the reusable staging provisioning script for
the `microsoft-graph` AppConnection. Its Graph access token is encrypted in
the control-plane database and the Rust gateway injects it only for
`graph.microsoft.com`; it must never be copied into the Kasm container. The
recorded Claude-originated live run is documented in
[`e2e-evidence-2026-07-12.md`](./e2e-evidence-2026-07-12.md) and returned Graph
`202` after the external wallet proof was verified.

## Local source stack

The reproducible local stack uses isolated ports so it cannot be confused with
an old container deployment:

- portal/API: `http://127.0.0.1:11254`
- gateway: `http://127.0.0.1:11255`
- PostgreSQL: `127.0.0.1:5433`
- Kasm desktops: `https://127.0.0.1:17901+`

Create `.env` from `.env.example`, pin a stable gateway signing seed, then run:

```bash
pnpm install
pnpm e2e:local:start
pnpm e2e:local:status
pnpm exec dotenv -e .env -- pnpm --filter @onecli/api e2e:openvtc-release
pnpm e2e:local:stop
```

`scripts/onecomputer/local-e2e.sh` applies migrations, seeds Demo Corp, builds
the gateway from the current checkout, and starts the portal and gateway from
that same source tree. On Homebrew systems where only the `rustup` executable is
on `PATH`, it resolves the actual Cargo and Rust compiler through `rustup which`.

The `e2e:openvtc-release` gate is a controlled wallet-boundary harness. It is
stronger than the former in-process signer because the private key is held by a
separate wallet process, but it is not evidence of production VTA/mobile
delivery until it uses the real OpenVTC VTA/mediator transport.

## Cryptographic release invariant

An `approved` database status is not authorization. The external OpenVTC wallet
signs a canonical `auth/step-up/approve-response/0.2` binding:

- protocol/version;
- employee identity as `payload.subject`;
- approval ID as `payload.sessionId`;
- random request nonce as `payload.challenge`;
- decision;
- manager DID as `issuer` and `proof.verificationMethod`;
- the ONEComputer RP DID as `recipient`.

The API resolves the manager's OpenVTC identity and company role, persists the
raw signed response, and only then emits the gateway-verifiable decision
credential. The gateway independently verifies the Data Integrity proof and
denies an approved status that lacks valid signed evidence or exact binding.

## Evidence to retain

Every candidate run should retain the Git SHA, policy rule, sandbox ID, gateway
approval ID, OpenVTC task hash, manager DID, signature verification result,
Graph request ID, audit events, and negative-case results.
