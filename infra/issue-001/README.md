# Issue 001: local Kasm workspace

This stack runs the employee Web UI, owned Control API/PostgreSQL, private
workspace controller, and the pinned local KasmVNC adapter. It creates only
`onecomputer-v4-*` runtime resources.

## Start

Copy the root `.env.example` to an ignored local env file and replace the three
local verification values:

```sh
cp .env.example .env.issue-001
docker compose --env-file .env.issue-001 -f infra/issue-001/compose.yml up -d --build
```

Open `http://127.0.0.1:4174/`. The first Kasm session uses a self-signed local
certificate, so the browser may require a one-time certificate exception.

## Stop

Stop or delete the workspace from the UI first, then preserve PostgreSQL while
stopping the stack:

```sh
docker compose --env-file .env.issue-001 -f infra/issue-001/compose.yml down
```

Only the workspace controller mounts the Docker socket. The Web and Control API
containers do not receive Kasm/Docker lifecycle authority.
