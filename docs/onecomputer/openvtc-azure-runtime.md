# ONEComputer × OpenVTC Azure runtime

This is the current Azure staging topology for the real external-wallet
approval path. It is intentionally separate from the older REST test-wallet
fixture documented in `azure-e2e-runbook.md`.

## Services

| Service                     | systemd unit             | Bind / public route                 | Key custody                             |
| --------------------------- | ------------------------ | ----------------------------------- | --------------------------------------- |
| DIDComm mediator            | `openvtc-mediator`       | `127.0.0.1:18120` / `/mediator/v1/` | mediator secret file, owner-only        |
| VTA                         | `openvtc-vta`            | `127.0.0.1:18110` / `/vta/`         | VTA seed store, owner-only              |
| ONEComputer DIDComm adapter | `openvtc-didcomm-bridge` | `127.0.0.1:18130/tasks`             | transport identity only; no manager key |
| Manager wallet              | `openvtc-wallet`         | no public listener; CLI service     | separate manager holder identity        |

The mediator is the only OpenVTC messaging ingress. Nginx terminates TLS and
passes DIDComm HTTP/WebSocket traffic to the loopback mediator. The wallet
service authenticates to that mediator using the OpenVTC browser-wallet core,
verifies the RP-signed `auth/step-up/approve-request/0.1`, and queues the task
outside the ONEComputer web UI. `openvtc-wallet.mjs approve <approval-id>` is
the explicit operator action; it signs `approve-response/0.2` and submits the
document to the wallet-only ONEComputer decision route.

## ONEComputer transport selection

The API selects the explicit OpenVTC DIDComm adapter with:

```text
OPENVTC_TRANSPORT_BINDING=didcomm
OPENVTC_TASK_ENDPOINT_URL=http://127.0.0.1:18130/tasks
OPENVTC_APPROVER_DID=did:peer:2.<manager-holder>
```

The loopback endpoint is not a wallet API exposed to users. It accepts only
the already RP-signed task from the local API, then sends it as an
authenticated DIDComm forward to the configured manager DID. The bridge does
not have the manager wallet store and cannot produce an approval proof.

Gateway holds automatically call the API's DIDComm dispatch seam after durable
ingest. The dispatch is idempotent: a successful delivery is recorded as
`sent_to_vti_adapter` and retries do not emit a second Trust Task. The manager
decision remains a separate wallet CLI/mobile action, and the ONEComputer web
UI cannot approve the hold.

### Staging mediator posture

The current Azure staging mediator is configured with OpenVTC's `open` network
posture (`explicit_deny` plus `ALLOW_ALL`) because the pinned mediator build does
not implement DIDComm coordinate mediation. The wallet and bridge therefore set
`OPENVTC_MEDIATOR_ENROLL=0`; the bridge uses an explicitly enabled direct
authenticated DIDComm message for this staging VM because the persisted manager
account has `RECEIVE_MESSAGES` but not `RECEIVE_FORWARDED`. This is acceptable
only for the isolated E2E VM; it is not a production ACL decision.

Production promotion must use a mediator build that supports coordinate
mediation, or a documented admin Trust Task/keylist bootstrap, and then run in
`closed` mode with explicit entries for the bridge and manager wallet DIDs. The
production starting-point recipe is
`deploy/openvtc/azure-mediator-production.toml`.

## Current security caveats

This is a development/staging deployment, not production key custody:

- the VTA setup currently uses its plaintext seed backend because the Azure
  managed identity has Key Vault Secrets User but not Secrets Officer/write
  permission;
- the manager wallet store uses the OpenVTC core's passthrough wrapper in an
  owner-only file while the CLI harness is being exercised;
- the staging mediator currently permits authenticated forwarding by default;
  the staging bridge currently uses direct local delivery; its closed-mode
  explicit forwarded-message ACL path remains a production promotion gate;
- production promotion requires Azure Key Vault/KMS for VTA material and a
  WebAuthn PRF, OS Keychain, or equivalent hardware-backed wrapper for the
  manager wallet;
- approvals are not accepted through the ONEComputer browser UI.

Do not copy, log, or commit the wallet store, VTA seed file, mediator
`secrets.json`, or any generated environment file. Public DIDs and service
URLs may be recorded; private key material may not.

## Verification commands

On the Azure VM:

```bash
systemctl is-active openvtc-mediator openvtc-vta openvtc-didcomm-bridge openvtc-wallet
ss -lntp | grep -E ':(18110|18120|18130)\\b'
curl -fsS https://onecomputer-openvtc.eastus2.cloudapp.azure.com/vta/health
```

The definitive acceptance gate remains the full business flow: admin policy
configuration → employee sandbox → Claude Outlook action → gateway hold →
DIDComm wallet alert → explicit CLI/mobile approval → signed response
verification → one-time Microsoft Graph side effect.

The latest hosted run is recorded in
[`e2e-evidence-2026-07-12.md`](./e2e-evidence-2026-07-12.md). The staging VTA
must be running for the runtime topology to be considered healthy; a stopped
VTA or a failing `/vta/health` endpoint is an infrastructure issue even though
the current direct-DIDComm wallet gate can operate without it.
