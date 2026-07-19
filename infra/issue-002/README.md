# Issue 002 local gateway slice

This stack extends the completed Kasm lifecycle with a pinned LiteLLM data
plane, disposable LiteLLM PostgreSQL, and a private model/MCP fixture.

The browser reaches only the Web proxy. Control owns the LiteLLM master key and
derives a short-lived key for each workspace. A workspace key is restricted to
the `onecomputer-assistant` model alias, the `onecomputer_fixture` MCP server,
and its `search_files` tool. The unassigned destructive `delete_file` tool is
used for negative verification.

The workspace network contains LiteLLM but not the fixture or either database.
LiteLLM reaches the fixture over the separate private gateway network.

For temporary local administration during this prototype, LiteLLM's Admin UI is
available at `http://127.0.0.1:4000/ui` and linked from ONEComputer's **Gateway**
navigation item. The binding is loopback-only and uses LiteLLM's own login. This
host exposure is a development exception and must be removed or replaced by an
authenticated ONEComputer admin route before production deployment.

Unless overridden with `ONECOMPUTER_LITELLM_UI_USERNAME` and
`ONECOMPUTER_LITELLM_UI_PASSWORD`, the temporary local login is `admin` /
`onecomputer-local-admin`. These development defaults are not production
credentials.

LiteLLM is pinned to `v1.93.0` and OCI index digest
`sha256:a1745e629abfb17d434426ff48b115f54f4f4c4a0f5af241de569e93c63c411e`.
Its database is deliberately disposable for this qualification slice.
