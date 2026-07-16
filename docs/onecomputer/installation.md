# ONEComputer OSS installation

The supported public installation path is a small source bootstrapper followed
by a deterministic local setup script. This keeps the first-run experience
short while keeping the source, package lockfile, database migrations, and
gateway code visible and reproducible.

## One-line setup

```bash
curl -fsSL https://raw.githubusercontent.com/ONE-Computer/onecomputer/main/scripts/install.sh | sh
```

The default flow:

1. Clones `ONE-Computer/onecomputer` into `~/.onecomputer/src`.
2. Reuses an existing checkout if that path already contains Git metadata.
3. Checks Node.js, pnpm, Docker, and Docker Compose before changing the repo.
4. Creates `.env` from `.env.example` with mode `600` if it does not exist.
5. Generates missing local encryption and gateway secrets without printing them.
6. Chooses PostgreSQL port `5432`, falling back to `5433` when the default is busy.
7. Installs from `pnpm-lock.yaml`, generates Prisma, starts PostgreSQL, and migrates.
8. Starts `pnpm dev`, which runs the web app and Rust gateway from source.

The script does not install Docker, Node.js, or Rust with `sudo`. Missing
prerequisites produce a direct installation instruction instead. This avoids a
privileged package-manager action hidden inside a `curl | sh` command.

## Useful options

```bash
# Prepare dependencies and PostgreSQL, then return to the shell.
curl -fsSL https://raw.githubusercontent.com/ONE-Computer/onecomputer/main/scripts/install.sh \
  | sh -s -- --no-start

# Preview the plan without cloning or changing anything.
curl -fsSL https://raw.githubusercontent.com/ONE-Computer/onecomputer/main/scripts/install.sh \
  | sh -s -- --dry-run --no-start

# Use an existing local checkout.
./scripts/install.sh --source-dir . --no-start

# Use a non-default PostgreSQL port.
./scripts/onecomputer/setup.sh --postgres-port 5433 --no-start
```

The setup script also accepts `--app-port` and `--gateway-port`. Rerunning it
does not remove containers or volumes. Existing `.env` values are preserved;
only empty or known placeholder values are generated.

## Prerequisites

- Git
- Node.js 18 or newer
- pnpm 9, enabled with Corepack when available
- Docker Engine or Docker Desktop with Docker Compose v2
- Rust/Cargo for the gateway development process

The installer checks Node, pnpm, and Docker before making changes. Rust is
needed when `pnpm dev` starts the gateway; install it through
[rustup](https://rustup.rs/) if it is missing.

## Security behavior

- The installer has no telemetry or analytics.
- It never prints `.env` values, wallet material, API keys, or generated keys.
- It does not modify Git remotes, force-reset branches, or delete data volumes.
- `.env` is created with mode `600` and is not committed by the repository.
- The public source path is intentionally used for OSS development while the
  Azure path remains governed by the deployment runbook and external OpenVTC
  wallet boundary.

Inspect the script before running it in a sensitive environment. For a reviewable
flow, clone the repository first and run `./scripts/install.sh --source-dir .`.

## Updating

Rerunning the installer reuses the existing checkout. It does not silently
discard local changes. Update deliberately:

```bash
cd ~/.onecomputer/src
git pull --ff-only
./scripts/onecomputer/setup.sh --no-start
```

## Scope boundary

This installer is for local OSS development and the local E2E path. It does not
provision Azure, Entra ID, OpenVTC/VTI services, TLS, DNS, or production
credentials. Use the Azure E2E runbook for those environments.
