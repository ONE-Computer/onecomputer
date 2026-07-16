# OneComputer CISO Control Room

## Purpose

The CISO control room is not a vanity dashboard. It must answer the questions a cyber team asks before approving AI-built apps and agents.

## Core questions

1. What AI apps and agents exist?
2. Who owns them?
3. What data and systems do they touch?
4. What identities and credentials do they use?
5. What actions are they allowed to take?
6. Which ones are risky, stale, overprivileged, or unapproved?
7. What happened recently?
8. Can I stop, revoke, or quarantine them now?
9. Can I export evidence for audit, GRC, or incident response?

## Required dashboard sections

### 1. Inventory

- Apps
- Agents
- Connectors
- Runtimes
- Credentials
- Owners
- Data classifications

### 2. Risk queue

Rank by:

- missing owner;
- high data sensitivity;
- broad connector access;
- long-lived credential;
- no recent review;
- external sharing;
- destructive/bulk actions;
- failed policy checks.

### 3. Passport view

Every app/agent gets a passport:

- owner;
- purpose;
- data classification;
- users/groups;
- runtime;
- connectors;
- credentials;
- approvals;
- evidence;
- expiry/review date;
- kill-switch status.

### 4. Evidence timeline

Timeline must include:

- deployment request;
- detected app type;
- data classification;
- approval policy;
- credential grant;
- runtime deploy;
- access event;
- policy decision;
- revoke/pause/delete event.

### 5. Actions

CISO/admin actions:

- pause app;
- revoke grant;
- rotate credential;
- require approval;
- quarantine connector;
- export evidence;
- delete runtime.

## Phase 1 implementation target

Start with the existing `Apps` surface and turn it into the wedge-demo control room:

- rename visible product language from OneCLI to OneComputer;
- show secure app fleet as the primary demo;
- add app passport and evidence language;
- keep InvGini as a pilot/customer lane, not the whole product.

## Review skills to run

Before demoing to a CISO, run:

- `/ciso-review`
- `/ai-agent-security-review`
- `/nhi-credential-review`
- `/cyber-evidence-review`
- `/shadow-ai-governance-review`
