# 004: add a push-capable OpenVTC companion web app

Status: `blocked`

Priority: P2
Depends on: 003
Unblocks: 005

## Outcome

A user running a headless workspace can enroll a supported browser as an
OpenVTC companion, receive a push notification for a pending governed
operation, open its safe summary, and approve or deny the exact request with a
device-signed decision. The Kasm desktop does not need to be open.

## In scope

- Build an installable companion web experience with a service worker and Web
  Push support for a declared browser/platform matrix.
- Reuse the existing OpenVTC task-consent envelope, operation digest, enrolled
  approver key, WebAuthn/platform-authenticator ceremony, decision verifier,
  durable delivery outbox, and ONEComputer operation truth.
- Let a signed-in user enroll, name, inspect, test, rotate/re-enroll, and revoke
  their own companion browser and push subscription.
- Send a generic notification containing no sensitive task content, credential,
  approval authority, or reusable operation data.
- Deep-link through normal authentication to the current server-rendered safe
  task summary, then require an explicit approve or deny signing gesture.
- Show notification permission, subscription health, last successful delivery,
  pending/expired/revoked/decided state, and actionable recovery guidance.
- Support multiple enrolled companion browsers without allowing duplicate
  notifications or decisions to create multiple legal execution paths.

## Out of scope

- Native iOS or Android applications, SMS/email approval, silent/background
  approval, approving from notification action buttons, embedding raw
  Microsoft content in a notification, making the push provider an authority,
  or replacing ONEComputer's durable operation and audit state.

## Required implementation

- Versioned companion enrollment and push-subscription contracts scoped to the
  exact tenant, user, approver key, browser installation, and revocation state.
- An owned push-provider adapter, encrypted transport usage, minimized payload,
  credential/key rotation, retry/backoff, expiry, deduplication, and
  metadata-minimized observability.
- A service-worker update and cache policy that cannot present a stale task as
  actionable or use cached authentication/decision material after sign-out or
  revocation.
- Authenticated task retrieval and the existing strict signed-decision
  verification for issuer, key, audience, tenant, subject, operation digest,
  decision, nonce, expiry, and replay.
- Headless-safe delivery that is independent of workspace/Kasm/browser-stream
  readiness and remains honest about platform background-push limitations.
- Accessible permission, enrollment, task review, approve/deny, terminal state,
  and recovery flows.

## Required verification

- [ ] On every supported browser/platform, an enrolled companion receives a
      background push, opens the exact pending safe summary, and completes
      physical approve and deny without opening Kasm.
- [ ] The notification payload and operating-system preview contain no raw task
      body, Microsoft content, user token, decision secret, approver private
      key, reusable bearer, or sufficient data to approve.
- [ ] Notification click, direct URL entry, reload, reconnect, duplicate/out-of-
      order delivery, delayed push, multiple devices, and Control/push-adapter
      restart preserve one durable legal terminal path.
- [ ] Wrong issuer/key/version/audience/tenant/subject/digest/decision/nonce,
      expired task, replay, mutation, revoked device, revoked subscription,
      signed-out browser, and stale service worker issue zero leases.
- [ ] Notification permission denial, unsupported platform, offline browser,
      invalid subscription, provider outage, retry exhaustion, and key rotation
      show honest recovery and never auto-approve or weaken verification.
- [ ] One valid physical approval issues at most one exact execution lease, and
      a denial or expiry can never execute.
- [ ] Logs, browser storage inspection, caches, screenshots, push-provider
      records, and evidence contain no prohibited key, credential, or sensitive
      task data.

## Evidence required

Include the browser/platform support decision, companion and push protocol
versions, provider/service-worker pins, minimized payload examples, enrollment
and revocation records, physical approve/deny transcripts with content
redacted, signed-decision negative matrix, multi-device and delivery/restart
matrix, notification screenshots with safe test data, operation/lease
correlation, storage/cache inspection, and cleanup.

## Stop conditions

- A supported platform cannot provide the required background notification and
  signing gesture without a native app or a revised product promise.
- Push delivery, possession of a URL/bearer, or a notification action would be
  treated as approval authority.
- The design requires raw sensitive task content, a device private key,
  provider credential, or durable authentication token in the notification.
- The companion would become a second source of operation truth or could issue
  execution independently of Control's verifier.

## Completion record

Not complete.
