# OneComputer Rebrand Map

## Decision

OneComputer is a fork of OneCLI, but not just a rename.

- **OneCLI**: credential gateway for AI agents.
- **OneComputer**: governed AI computer platform for enterprise apps and agents.

OneComputer keeps the credential gateway as a core subsystem and expands into secure deployment, CISO control, evidence, and revocation.

## Phase 1 rename scope

Renamed now:

- root README product narrative;
- root package name;
- visible dashboard product strings;
- Docker compose project/service defaults;
- `.env.example` defaults;
- secure app docs language;
- OneComputer docs folder.

Kept temporarily:

- internal workspace package scope `@onecli/*`;
- source import paths from `@onecli/ui`, `@onecli/api`, and `@onecli/db`;
- upstream gateway internals where rename would cause avoidable lockfile/import churn;
- some historical InvGini docs that describe work performed when this was still OneCLI.

## Why keep `@onecli/*` temporarily?

Changing every internal package name is not hard, but it is noisy. It touches imports, lockfile, generated build metadata, and docs at once. That makes review harder and increases the chance that the first wedge demo breaks because of a cosmetic rename.

CEO/product priority is:

1. prove the governed deployment wedge;
2. make visible product surfaces say OneComputer;
3. rename internals after the demo path is stable.

## Phase 2 rename checklist

- Rename package scopes from `@onecli/*` to `@onecomputer/*`.
- Update imports across `apps/*` and `packages/*`.
- Regenerate `pnpm-lock.yaml`.
- Rename gateway crate/package if needed and regenerate `Cargo.lock`.
- Rename env vars from `ONECLI_*` to `ONECOMPUTER_*` with backward-compatible aliases.
- Rename public assets and favicon.
- Update GitHub org/repo links once the real fork exists.
- Update install script and container registry paths.

## Compatibility rule

Do not remove OneCLI compatibility aliases until:

- existing demos run under OneComputer names;
- docs show the new command path;
- CI passes after lockfile regeneration;
- any pilot customer scripts are migrated.
