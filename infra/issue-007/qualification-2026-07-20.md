# Issue 007 qualification — 2026-07-20

## Route and policy

- Public policy alias: `onecomputer-assistant`.
- Gateway-only deployment pin: `openai/gpt-5.6-luna`.
- Provider credential location: LiteLLM environment only.
- Workspace key identity: tenant `acme`, subject `alex-morgan`, workspace
  `b4a2ea8c-cc94-46e3-b6c8-59ae4ebee508`, agent
  `eec5a8f7-2299-4b1f-92f7-409dbb65dd75`, policy version
  `14793361-6679-46f0-b1a0-d0096d8c26b2`.
- Limits: USD 1/30 days, 30 RPM, 50,000 TPM, four parallel requests.
- Fallback: none. The configuration has one deployment and no fallback map.

## Sandbox route probes

The live probes ran from the existing isolated Kasm container with its assigned
workspace-agent key. Content was discarded after deriving the recorded byte
count and digest.

| Probe | Result | Safe evidence |
| --- | --- | --- |
| Normal alias call | HTTP 200 | 36 total tokens; response content present |
| Streaming alias call | HTTP 200 | 29 total tokens; response content present |
| Unassigned alias | HTTP 403 | denied before provider use |
| Raw provider model | HTTP 403 | denied before provider use |
| Direct provider URL from Kasm | unreachable | `URLError`; controlled network remained internal |

Control ownership tests separately deny cross-tenant and cross-subject workspace
access. The scoped key is injected only into its owned sandbox and is not
returned by Control or Web.

## Limit and lifecycle probes

Qualification keys used synthetic identities and were deleted after each probe.

| Probe | Result |
| --- | --- |
| Revoked key | HTTP 401 |
| Expired key | HTTP 401 |
| Token limit | HTTP 429 |
| Cost limit | HTTP 429 |
| First request under 1 RPM | HTTP 200 |
| Second request under 1 RPM | HTTP 429 |

For outage behavior, LiteLLM's only provider-egress network was temporarily
removed while the workspace-to-gateway network remained available. The assigned
call timed out as unavailable and no other deployment answered. The network was
restored immediately and the next assigned call returned HTTP 200.

LiteLLM was then restarted. Workspace-agent spend was `0.00031200` USD both
before and immediately after restart, health returned to `healthy`, and the next
assigned call returned HTTP 200. Routing configuration and usage truth therefore
survived restart.

## Attribution and retention

The successful normal and streaming rows were grouped under:

- model group `onecomputer-assistant`;
- the deterministic ONEComputer LiteLLM user id;
- the deterministic ONEComputer workspace-agent id.

At the first attribution check, the two successful rows totaled 65 tokens and
USD `0.00018000`. The matching verification-token row carried the exact tenant,
subject, workspace, agent, and policy-version metadata plus the configured
budget and rate limits. One obsolete pre-policy default workspace grant was
revoked; one active policy-bound grant remains.

Secret and retention scans found:

- provider key present in LiteLLM only;
- provider key absent from Control, Web, workspace controller, and Kasm;
- provider key absent from LiteLLM and Control logs;
- synthetic prompt marker absent from LiteLLM and Control logs;
- recent spend rows held no synthetic prompt phrase or response `content` field;
  the maximum retained `messages` and `response` JSON length was two bytes (`{}`).

## Automated checks

- `npm test`: 55 passed.
- `npm run build`: passed for all workspaces and the production Web bundle.

## Human review

The product owner restarted onto image
`sha256:381953bc61e7ebd18dde078f8a1a849f9fd9b071478b44fe31766c5396717243`,
accepted `status`, normal chat, and streaming chat from the sandbox agent, and
confirmed the safe Web alias, remaining budget, 30 RPM, and no-fallback state.
The current presentation was accepted as sufficient for the MVP, with visual
polish deferred.
