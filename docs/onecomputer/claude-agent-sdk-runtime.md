# Claude Agent SDK runtime requirement

ONEComputer sandboxes are used by ONEVibe as the execution boundary for
Claude agents. Claude Code CLI availability is not sufficient for this
contract: the sandbox must also contain the Claude Agent SDK so a Node worker
can call `query()` directly and stream native SDK messages into ONEVibe's
durable journal/SSE projection.

The Kasm bootstrap installs the pinned runtime dependency:

```text
@anthropic-ai/claude-agent-sdk@0.3.210
```

Bootstrap must fail closed unless both checks pass:

```sh
claude --version
NODE_PATH=/home/kasm-user/.npm-global/lib/node_modules node -e "const {createRequire}=require('node:module'); createRequire(process.cwd() + '/.onevibe-agent-sdk.mjs').resolve('@anthropic-ai/claude-agent-sdk')"
```

The package is installed as an image/bootstrap dependency alongside
`@anthropic-ai/claude-code`, `pptxgenjs`, and `pdf-lib`; it must not be
installed by an agent during a user task. A sandbox is not `bootstrapped` until
the SDK module check succeeds. This keeps model execution deterministic and
prevents a task from silently switching to a CLI-only runtime.

ONEVibe transfers the worker source into the conversation workspace and
executes it with Node 22. The worker owns the SDK query, session persistence,
LiteLLM environment, bounded tool list, and raw journal. ONEComputer remains
the provider/control boundary; the web browser receives only server-projected
events and never receives the sandbox process, credential, X11, or VNC handle.

The corresponding ONEVibe proof is documented in
`onevibe/docs/ONECOMPUTER-CLAUDE-AGENT-SDK.md`. A fresh Azure deployment must
be run before claiming the combined SDK + visual + SSE gate.
