# Issue 007 real model route

This slice maps the stable policy alias `onecomputer-assistant` to one pinned
OpenAI deployment inside LiteLLM. The provider key is supplied to LiteLLM as
`OPENAI_API_KEY`; Control, Web, the workspace controller, and Kasm receive no
provider credential.

The workspace-agent virtual key is still short-lived and renewable independently
of the persistent workspace. It grants exactly the policy alias and assigned MCP
tools, and carries the tenant, subject, workspace, agent, and policy-version
identity chain.

MVP limits per workspace agent:

- USD 1 per 30 days;
- 30 requests per minute;
- 50,000 tokens per minute;
- four parallel requests;
- no fallback deployment.

`onecomputer-agent chat PROMPT` and `onecomputer-agent stream PROMPT` send model
traffic directly from the sandbox to LiteLLM. ONEComputer Web reads only safe
availability, limit, and spend metadata; its availability check never sends a
prompt.

The qualification probes intentionally print only status codes, token counts,
content byte counts, and response digests. They never print keys, prompts, or
model output.
