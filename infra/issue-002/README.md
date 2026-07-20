# Issue 002 local gateway slice

This stack extends the completed Kasm lifecycle with a pinned LiteLLM data
plane, LiteLLM PostgreSQL, and a private model/MCP fixture. The database began
as disposable qualification storage; Issue 008 moved it to the named
`onecomputer-v4-litellm-postgres-data` volume because per-user OAuth credentials
must survive service replacement and restart.

The browser reaches only the Web proxy. Control owns the LiteLLM master key and
derives a renewable short-lived key for each persistent workspace. A workspace
key is restricted to
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
Its database now requires a dedicated stable `LITELLM_SALT_KEY` supplied by
`ONECOMPUTER_LITELLM_SALT_KEY`. The salt and persistent volume are part of the
Issue 008 OAuth custody boundary and are not optional in that deployment.

## Governed operation extension

The same local stack now carries the Gate C fixture flow. `POST
/v1/operations/delete-file` persists an approval-required operation in owned
PostgreSQL before any MCP call. The temporary fixture decision endpoint signs
and verifies a bound decision inside Control, issues one compare-and-swap lease,
and uses a 60-second LiteLLM key limited to `delete_file`. The UI shows the
pending request, local-fixture approve/deny controls, and the durable receipt.

This fixture is not the production approval channel. It exists to prove the
operation binding and exactly-once path before OpenVTC/VTA integration.
