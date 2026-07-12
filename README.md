# ONEComputer

ONEComputer is a business and enforcement layer for governed AI computers.
It gives administrators a way to define company policy, gives employees an
isolated sandbox for AI work, and places a policy gateway between that runtime
and sensitive external systems.

The north-star flow is:

```text
admin policy
  -> employee sandbox
  -> Claude or another agent
  -> policy gateway
  -> external system
  -> OpenVTC wallet approval when required
  -> verified, one-time release
```

ONEComputer owns the business surface, sandbox orchestration, policy authoring,
gateway enforcement, connector boundaries, and audit correlation. OpenVTC/VTI
owns identity, wallet key custody, Trust Task transport, human approval proofs,
and trust authority.

## Repository status

This repository is a curated public import of the ONEComputer integration line.
The historical development archive remains separate so public history does not
expose internal experiments, stale workflow artifacts, or environment-specific
material.

The primary implementation areas are:

- `apps/web` — administrator and operator control plane;
- `apps/gateway` — Rust HTTP policy gateway and credential injection boundary;
- `packages/api` — policy, sandbox, connector, approval, and audit APIs;
- `packages/db` — Prisma schema and migrations;
- `deploy` — deployment and runtime configuration templates;
- `docs/onecomputer` — technical architecture and E2E runbooks.

OpenVTC dependencies and separately hosted services are maintained in their own
repositories under the `ONE-Computer` GitHub organization. They are not silently
vendored into this application.

## Local development

Requirements: Node.js 18+, pnpm 9+, Docker, and Rust for the gateway.

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:up
pnpm db:migrate
pnpm dev
```

The default local services are:

- dashboard/API: `http://127.0.0.1:10254`;
- policy gateway: `http://127.0.0.1:10255`.

For the isolated local acceptance path:

```bash
pnpm e2e:local:start
pnpm e2e:local:status
pnpm e2e:local:stop
```

Never commit `.env`, credentials, wallet stores, mediator state, APNs keys,
or generated Azure environment files.

## Security model

An approval status in the database is not authorization. A release requires a
valid, bound OpenVTC-signed response from the external wallet. The gateway
independently verifies the proof, challenge, subject, action binding, expiry,
approver authority, and replay state before forwarding the request.

The ONEComputer web UI is not an approval authority and must not hold manager
private keys. Push notifications are wake-up signals only; sensitive action
content stays inside the encrypted Trust Task transport.

## Related repositories

The organization maintains forks of the OpenVTC building blocks used by this
integration, including the VTA, browser plugin, mobile agent, DIDComm, push
gateway, setup tools, RP SDK, governance, and Trust Task repositories. See the
organization documentation site for the current repository boundary and
promotion policy.

## License

Apache-2.0. See [LICENSE](./LICENSE).
