# ONEComputer × OpenVTC E2E evidence — 2026-07-12

This record captures the latest Azure staging acceptance run. It proves the
business path from company policy through a real Claude process in a Kasm
sandbox, a separate OpenVTC wallet approval, and a real Microsoft Graph side
effect.

## Build and deployment identity

- Repository branch: `codex/azure-e2e-openvtc`
- Local implementation commit: `807b2b5`
- Azure checkout: `/home/azureuser/work/onecomputer`
- Azure deployed checkout: `d512f46`
- Public portal: `https://onecomputer-openvtc.eastus2.cloudapp.azure.com`
- Public health: `/v1/health` returned `status: ok`
- Azure services: web, gateway, mediator, VTA, DIDComm bridge, and wallet
  were active after the final validation.

This is a feature-branch staging runtime. It has not been merged to `main` and
must not be treated as a production release.

## Admin policy and employee sandbox

The admin persona created organization-wide `manual_approval` rules through the
ONEComputer API for Microsoft Graph Outlook sends. The employee persona then
created the real Kasm sandbox `claude-openvtc-employee-1783857`, which reached
`started`, `desktopReady: true`, and Claude Code `2.1.207`. The sandbox was
deleted after the run; old user sandboxes were left untouched.

The employee's Claude process ran inside that sandbox. Its `curl` request did
not contain an `Authorization` header. The gateway selected the encrypted
Microsoft Graph AppConnection and owned credential injection.

## Final Claude → wallet → Graph run

```text
ONEComputer approval id: 0e62f4f8-e49b-4927-96a7-ac6c9353cca1
Gateway approval id:     bdd84cc8-d69e-4511-b251-abbb7b95c44e
Action status:           approved
VTI adapter:             openvtc-didcomm-bridge
Delivery attempts:       1
Gateway hold:            MANUAL APPROVAL required
Wallet task:             received by /var/lib/openvtc/wallet/pending
Wallet decision:         separate CLI approve command
Proof verification:      Rust gateway verified the signed OpenVTC proof
Release:                 gateway forwarded exactly once
Graph result:             HTTP 202 Accepted
Gateway injection count: 1
```

The wallet private material was not in the web UI, sandbox, or ONEComputer
checkout. The wallet task was consumed after approval and the temporary
employee sandbox and command-output files were removed.

The gateway log sequence was:

1. `MANUAL APPROVAL required` for the organization policy.
2. durable approval created via the internal API (`201`).
3. automatic DIDComm delivery recorded as `sent_to_vti_adapter`.
4. `OpenVTC manager confirmation proof verified`.
5. `VC verified, releasing`.
6. `APPROVED — forwarding request`.
7. Microsoft Graph returned `202` with `injections_applied=1`.

## Cryptographic negative cases

The controlled DIDComm release gate also ran on Azure before the final Claude
run:

```text
approvalId:              61a61d90-41d0-480a-8457-3307b950ba65
walletTaskReceived:      true
cryptographicallyVerified: true
unsignedRejected:        true
replayRejected:          true
```

Those negative cases remain mandatory: an `approved` database status alone is
not authorization, and the gateway must reject unsigned, stale, altered,
incorrectly-bound, denied, timed-out, and replayed responses.

## What is proven

- Admin policy configuration works at company scope.
- An employee can launch an isolated sandbox and run Claude Code.
- Claude's outbound Outlook request traverses the ONEComputer gateway without
  receiving a Graph bearer token.
- The gateway creates a durable hold and automatically alerts the separate
  OpenVTC wallet over the hosted DIDComm bridge.
- The wallet CLI is the approval surface; the ONEComputer web UI is not.
- Rust verifies the signed manager proof and exact approval binding before
  release.
- The released request reaches the real Microsoft Graph connector and returns
  `202`.

## Staging caveats and production gates

The Azure mediator currently uses an open/direct-delivery staging posture
because the pinned mediator build does not support the required coordinate
mediation flow. Production must use a closed mediator with explicit ACL/keylist
entries, a production VTA deployment, and a documented DIDComm/TSP trust
bootstrap. The VTA seed is still plaintext on this staging VM and the manager
wallet store uses a passthrough wrapper; both require Key Vault/KMS and
hardware-backed wallet custody before production.

OpenVTC-native login is still a separate promotion gate. Entra/demo auth is
only a temporary migration harness for this staging acceptance run; it is not
the approval authority.
