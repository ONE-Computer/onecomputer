# OpenVTC external approver contract

This is the boundary between ONEComputer and the manager's separate OpenVTC
wallet/VTA. The browser portal is not an approval device.

## Request

ONEComputer creates a canonical, RP-signed Trust Task:

```json
{
  "id": "urn:uuid:<request-id>",
  "type": "https://trusttasks.org/spec/auth/step-up/approve-request/0.1",
  "issuer": "<ONECOMPUTER_RP_DID>",
  "recipient": "<MANAGER_APPROVER_DID>",
  "issuedAt": "<rfc3339>",
  "payload": {
    "subject": "<EMPLOYEE_DID>",
    "sessionId": "<ONECOMPUTER_APPROVAL_ID>",
    "challenge": "<base64url-random-nonce>",
    "reason": "outlook.send_email: <human-readable preview>",
    "targetAcr": "aal2",
    "acceptableEvidence": ["did-signed", "webauthn"],
    "ttl": 300,
    "ext": {
      "org.onecomputer.authorization-context": {
        "approvalId": "<ONECOMPUTER_APPROVAL_ID>",
        "action": "outlook.send_email",
        "requestedActionDigest": "sha256:<digest>"
      }
    }
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "<ONECOMPUTER_RP_DID>#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "<multibase-signature>"
  }
}
```

The wallet must verify the request proof and show `payload.reason` verbatim
before asking the manager to decide. It must not trust a browser-rendered
summary or a mutable database status.

## Response

For approval, the external wallet signs this exact Trust Task shape. For a
delegated manager, `issuer` is the manager DID and `payload.subject` remains
the employee DID.

```json
{
  "id": "urn:uuid:<response-id>",
  "type": "https://trusttasks.org/spec/auth/step-up/approve-response/0.2",
  "issuer": "<MANAGER_APPROVER_DID>",
  "recipient": "<ONECOMPUTER_RP_DID>",
  "issuedAt": "<rfc3339>",
  "payload": {
    "subject": "<EMPLOYEE_DID>",
    "sessionId": "<ONECOMPUTER_APPROVAL_ID>",
    "challenge": "<the-request-challenge>",
    "decision": "approved",
    "grantedAcr": "aal2"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "<MANAGER_APPROVER_DID>#<key-fragment>",
    "proofPurpose": "assertionMethod",
    "proofValue": "<multibase-signature>"
  }
}
```

A denial uses the same signed document with `decision: "denied"` and a
`deniedReason`. Denials are retained for audit and never release the gateway.

## Submission

The wallet submits only the signed document to:

```text
POST /v1/openvtc-approvals/<ONECOMPUTER_APPROVAL_ID>/decide
Content-Type: application/json

{"document": <signed-response>, "comment": "optional audit note"}
```

No ONEComputer browser cookie is accepted on this route. The API checks that
the issuer is a provisioned OpenVTC identity with an owner/admin/manager
company role, persists the raw response, and issues its own decision VC. The
gateway then independently verifies the manager proof, issuer, subject,
session, challenge, recipient, cryptosuite, and single-use pending state.

Current gateway proof verification supports `did:key` manager response keys.
The next identity slice must replace the temporary `OrganizationMember` role
projection with verified VMC/M-DID/trust-registry claims and add the pinned
OpenVTC resolver path for `did:webvh`/`did:peer` where required.

## Controlled wallet fixture

`packages/api/src/scripts/openvtc-test-wallet.ts` is an external-process
acceptance fixture. It owns a test Ed25519 seed in memory, accepts the canonical
request through the explicit REST contract seam, emits a contentless-alert
record, and signs only after an explicit operator call. It is useful for proving
the Azure release boundary while VTA/mediator infrastructure is being deployed;
it is not a replacement for the OpenVTC VTA, DIDComm mediator, TSP binding, or
production wallet custody.
