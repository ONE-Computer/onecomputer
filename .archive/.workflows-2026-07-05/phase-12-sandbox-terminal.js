export const meta = {
  name: "phase-12-sandbox-terminal",
  description:
    "Sandbox detail page + real in-browser terminal (xterm.js over exec polling) + one-click risky action for the CEO demo (demo beat 3d, 4a-Option-A)",
  phases: [
    {
      title: "Detail route",
      detail: "GET /v1/sandboxes/:id detail + sandbox detail page shell",
    },
    {
      title: "Terminal API",
      detail: "Exec-backed pseudo-terminal endpoint (one-shot exec, no PTY)",
    },
    {
      title: "Terminal UI",
      detail: "xterm.js component wired to the terminal API",
    },
    {
      title: "Risky action",
      detail:
        "One-click 'Attempt Outlook send' button that routes through the gateway",
    },
    {
      title: "Verify+Commit",
      detail: "tsc + browser checks + commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const WEB = `${REPO}/apps/web/src`;
const API = `${REPO}/packages/api/src`;

// VERIFIED SEAMS (2026-07-04), so agents don't rediscover or invent:
// - Exec is ONE-SHOT: daytona-service.ts:158 POST toolbox :4000/process/execute
//   returns {exitCode, output}. There is NO PTY / websocket / SSE anywhere in
//   packages/api or apps/web. Do NOT invent a websocket transport — build a
//   command-at-a-time terminal on top of the existing one-shot exec.
// - Route today: POST /sandboxes/:id/exec (routes/sandboxes.ts:70) -> execInSandbox().
// - UI today: sandboxes-content.tsx has list + NewSandboxDialog + ExecDialog
//   (text input + JSON output). No detail page.
const CTX = `
Repo: ${REPO}
Web: ${WEB}
API: ${API}
Web app runs at http://127.0.0.1:10254 (AUTH_MODE=local, no login).

HARD FACTS you must respect (verified against source, do not contradict):
- Sandbox exec is ONE-SHOT ONLY: packages/api/src/services/daytona-service.ts execInSandbox()
  does POST http://127.0.0.1:4000/toolbox/<id>/process/execute {command} -> {exitCode, output}.
- There is NO websocket / SSE / PTY infrastructure anywhere. Do NOT add socket.io/ws.
  Build a "command-at-a-time" terminal: each entered line is one exec POST; render output.
- Existing UI: apps/web/src/app/(dashboard)/sandboxes/_components/sandboxes-content.tsx
  (list, NewSandboxDialog, ExecDialog). Existing API route: packages/api/src/routes/sandboxes.ts.
- This is a DEMO terminal, not a real PTY. Label it honestly in a tooltip:
  "Command console (one command per line; not a full interactive shell)".
- Do NOT claim REAL for anything not proven by a live 200 + real sandbox output.
`;

phase("Detail route");
const detail = await agent(
  `${CTX}
## Agent 12-A: Sandbox detail route + page shell

1. API: ensure GET /v1/sandboxes/:id returns a single sandbox with full fields
   (id, name, state, createdAt, snapshot, agentId if any). If it already exists in
   routes/sandboxes.ts, confirm and return the shape; if not, add it via the existing
   daytona-service getter. Reuse existing service functions — do not duplicate.
2. Web: create the detail page at
   apps/web/src/app/(dashboard)/sandboxes/[id]/page.tsx
   and apps/web/src/app/(dashboard)/sandboxes/[id]/_components/sandbox-detail.tsx
   - header: name, state badge (reuse STATE_BADGE map from sandboxes-content.tsx —
     extract it to a shared module if needed, do NOT copy-paste the object),
     uptime, snapshot id, kill button.
   - Make each sandbox row in the list link to /sandboxes/<id>.
3. Follow CLAUDE.md: one component per file, named exports, @onecli/ui components.

Run: cd ${REPO}/apps/web && npx tsc --noEmit
Return: files changed, the GET /v1/sandboxes/:id JSON shape, tsc result.
`,
  { label: "12-A:detail-route", phase: "Detail route" },
);

phase("Terminal API");
const termApi = await agent(
  `${CTX}
## Agent 12-B: Terminal-backed exec endpoint

The existing POST /v1/sandboxes/:id/exec is fine as the transport. Confirm it accepts
{ command } and returns { exitCode, output }. Do NOT change its contract.

Add ONE thing only if missing: a working-directory + environment nicety so consecutive
commands feel shell-like. Since exec is one-shot and stateless, implement a lightweight
convention: the web client prefixes each command with a cd into a persistent workdir,
e.g. run 'cd /home/daytona/work 2>/dev/null; <command>'. Keep this in the WEB client,
not the API, so the API stays a clean one-shot exec. Document that state does not persist
between commands beyond the filesystem.

Do NOT build sessions/PTY. Return: confirmation of exec contract + where the cd-prefix
convention will live (client-side).
`,
  { label: "12-B:terminal-api", phase: "Terminal API" },
);

phase("Terminal UI");
const termUi = await agent(
  `${CTX}
## Agent 12-C: xterm.js command console

Add xterm.js to the sandbox detail page.

1. Add deps to apps/web: @xterm/xterm and @xterm/addon-fit (check package.json first;
   if a different major is already present, use it). Import the xterm CSS.
2. Create apps/web/src/app/(dashboard)/sandboxes/[id]/_components/sandbox-terminal.tsx
   ("use client"):
   - Render an xterm Terminal, fit to container.
   - Prompt line "daytona@<shortId>:~$ ". On Enter, take the typed line, POST it to
     /v1/sandboxes/:id/exec via the existing sandboxesApi client (prefix with the
     cd-into-workdir convention from 12-B), then write the returned output + a new prompt.
   - Show a spinner/"…" while the exec POST is in flight; disable input during it.
   - Handle non-zero exitCode by printing it dimmed.
   - Tooltip/help line under the terminal: "Command console — one command per line,
     runs via governed exec. Not a full interactive shell."
3. Mount it in sandbox-detail.tsx in a card titled "Console".

Run: cd ${REPO}/apps/web && npx tsc --noEmit
Return: files changed, deps added, tsc result.
`,
  { label: "12-C:terminal-ui", phase: "Terminal UI" },
);

phase("Risky action");
const risky = await agent(
  `${CTX}
## Agent 12-D: One-click risky action (the demo trigger)

On the sandbox detail page, add a card "Try a governed action" with a button
"Attempt Outlook send". This is the action that (after phase-14) will be held for
approval by the gateway.

Implementation (demo-honest):
- The button runs, via the console exec path, a curl from INSIDE the sandbox that goes
  through the gateway to graph.microsoft.com/v1.0/me/sendMail (POST). Use the sandbox's
  configured HTTPS_PROXY (the gateway). If the sandbox isn't yet proxy-configured, print
  a clear message: "Sandbox not gateway-routed yet — see phase-14".
- Show the raw result (expected today: forwarded or blocked depending on policy; after
  phase-14: held then approved/denied).
- Add a small "What will happen" explainer listing: policy match -> gateway hold ->
  manager + user step-up -> approve/deny. Mark which parts are live vs simulated TODAY.

Do NOT fake the result. Print whatever the gateway actually returns.

Run tsc. Return: files changed, and the actual output observed when clicking (paste it).
`,
  { label: "12-D:risky-action", phase: "Risky action" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}
## Agent 12-E: Verify + commit

Run and PASTE real output (do not summarize as "passed"):
  cd ${REPO}/apps/web && npx tsc --noEmit
  curl -s -o /dev/null -w "detail:%{http_code}\\n" http://127.0.0.1:10254/sandboxes
  # If a sandbox exists, curl its detail page and the exec route with a real 'echo hi' command.

Only if tsc is clean, commit:
  cd ${REPO}
  git add -A apps/web/ packages/api/
  git commit -m "feat(sandbox): detail page + xterm command console + risky-action trigger

Sandbox detail route/page, xterm.js command-at-a-time console over the existing
one-shot exec (no PTY/websocket added), and a one-click 'Attempt Outlook send'
that routes through the gateway. Demo beats 3d and 4a (Option A).

tsc --noEmit: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Then append a dated result to gbrain ~/brain/projects/onecomputer-enterprise-ux-gap.md
(what is REAL vs simulated) and STATE.md. Do NOT run gbrain import (OpenAI key is currently broken — note it instead).
Return: commit hash + pasted verification output.
`,
  { label: "12-E:verify-commit", phase: "Verify+Commit", model: "haiku" },
);

return { detail, termApi, termUi, risky, commit };
