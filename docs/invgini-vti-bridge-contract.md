# InvGini VTI Bridge Contract for OneCLI

Date: 2026-06-20

OneCLI is the SecOps command center for InvGini-created agents. It does not need
raw platform connector identifiers to govern an agent fleet. VTI bridge metadata
must arrive as opaque-handle and Trust Task references.

## Accepted event fields

`ActionRequested` and `ReceiptCreated` events may include an optional `vtiBridge`
object.

Required invariants when present:

- `connectorCustodyMode` is `opaque_handle`.
- `rawConnectorIdPresent` is `false`.
- `opaqueHandle.id` identifies the bridge-side handle.
- raw fields such as `chatId`, `phoneNumber`, `emailAddress`, `rawConnectorId`,
  and platform user IDs are rejected inside `vtiBridge`.

## Why this exists

The exact `vti-message-bridge` API is not yet available in this workspace. This
contract lets OneCLI and InvGini move safely without guessing the DIDComm wire
protocol. The real bridge can later populate the same fields with signed Trust
Task IDs, VTA policy refs, consent VC refs, and hash-chain anchors.

## Evidence pack

OneCLI exposes a project/org-scoped evidence-pack shape for an agent principal.
It includes:

- principal DID and trust metadata;
- mandates and grants;
- action requests and receipts;
- SecOps control intents;
- extracted VTI bridge artifacts.

This is the first step toward a JSON/PDF/ZIP audit export.

## 2026-06-20 hardening note

OneCLI validation now rejects additional raw connector key variants inside `vtiBridge`, including `messageId`, `message_id`, `userId`, and `user_id`. The DB-backed InvGini API E2E validator now includes a negative ingest case proving an event with a raw platform `messageId` inside `vtiBridge` is rejected instead of persisted.
