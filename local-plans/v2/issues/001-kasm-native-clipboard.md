# 001: make Kasm clipboard use native copy and paste

Status: `complete`

Priority: P0
Depends on: —
Unblocks: 002

## Outcome

A user can copy and paste text directly between their local desktop and the
Kasm workspace with the normal platform shortcuts. The successful product path
does not require opening Kasm's clipboard helper and pasting through an
intermediate text box.

## In scope

- Inspect the current Kasm, browser, streaming protocol, desktop environment,
  and application clipboard path before selecting the fix.
- Support explicit, user-initiated, bidirectional text copy/paste for the
  declared browser and host-platform support matrix.
- Make the behavior work in the workspace terminal, a native text editor, and
  Claude Desktop, including multiline and Unicode text.
- Provide concise permission, unsupported-browser, disconnected, and
  policy-disabled states in the ONEComputer workspace UI.
- Preserve authenticated session, tenant, user, and workspace boundaries across
  the clipboard transport.
- Keep the upstream Kasm helper available only as a documented fallback for an
  unsupported or permission-denied environment, not the normal journey.

## Out of scope

- Unprompted clipboard history collection, background clipboard monitoring,
  cross-workspace clipboard sharing, file transfer, rich document fidelity,
  image transfer, or bypassing browser permission and security rules.

## Required implementation

- An owned clipboard capability contract around the pinned Kasm integration,
  including direction, supported MIME type, size limit, readiness, and reason
  codes.
- The smallest pinned Kasm/noVNC/WebSocket configuration or adapter change that
  makes standard copy/paste gestures work.
- Explicit user-gesture and browser-permission handling; no ambient reads from
  the local clipboard.
- Reconnect-safe lifecycle behavior that cannot send clipboard data to a stale,
  wrong-user, or wrong-workspace stream.
- Metadata-only observability. Clipboard contents and content-derived values
  must not be logged, persisted, analyzed, or placed in evidence.

## Required verification

- [x] Local-to-workspace and workspace-to-local copy/paste work with normal
      shortcuts in the terminal, text editor, and Claude Desktop without
      opening the Kasm clipboard helper.
- [ ] Empty, multiline, Unicode, newline-style, near-limit, and over-limit
      inputs produce defined behavior without silent truncation or corruption.
- [ ] Permission denied, unsupported browser, disconnected stream, workspace
      stop/restart, browser reload, and relay restart show honest recovery
      states and never deliver to a stale session.
- [ ] A user cannot read or write another tenant's, user's, or workspace's
      clipboard channel by changing IDs, reconnecting an old relay, replaying a
      message, or opening concurrent workspaces.
- [ ] Clipboard content is absent from server logs, browser console telemetry,
      screenshots, databases, crash reports, and the evidence bundle.
- [ ] Existing workspace authentication, keyboard input, display streaming,
      lifecycle actions, and Kasm persistence still pass.

## Evidence required

Include the Kasm and streaming-component pins, browser/host support matrix,
clipboard contract tests, redacted application matrix, permission and reconnect
matrix, cross-workspace isolation probes, deployed configuration inspection,
and a content-leak scan.

## Stop conditions

- Normal copy/paste requires a browser-unsafe workaround, an unauthenticated
  relay, global clipboard access, or persistence of clipboard contents.
- The pinned Kasm/streaming stack cannot provide the requested path on the
  chosen support matrix without a product or licensing decision.
- The fix would weaken workspace session isolation or expose clipboard data to
  Control, the egress proxy, LiteLLM, or another workspace.

## Completion record

Complete on 2026-07-23 by product-owner acceptance.

Automated qualification passes 110/110 tests and the production build. The
deployed Chromium path uses KasmVNC's native, user-gesture clipboard in both
directions without opening the helper; terminal and Mousepad paste probes pass,
the owned ready state loads, the 64 KiB `text/plain` boundary is present in the
live Xvnc process, workspace restart/browser reload recover, and the persistent
home survives restart. The final image is
`sha256:28dd1ff7bcfdfbe7ff6cb39a9750f042fc5b3e3b197ed1e09c846dbd83531b5c`.

Human application verification was confirmed on 2026-07-23: normal shortcuts
work without opening the Kasm clipboard helper. The product owner accepted the
remaining recorded qualification limitations and directed the issue to be
considered done. Those limitations remain documented in the evidence bundle
and are not broader security claims.

Evidence:
`.artifacts/v2/issues/001/20260723T040603Z/`
