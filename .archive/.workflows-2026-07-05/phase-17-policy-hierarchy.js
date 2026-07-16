export const meta = {
  name: "phase-17-policy-hierarchy",
  description:
    "Make manager/team-level policy real: treat Project as Team in UI, and wire strictest-wins merge of org + project + agent PolicyRules into the gateway enforcement path (not just the simulator_only guardrails service). Demo beats 1 + 2.",
  phases: [
    {
      title: "Merge design",
      detail:
        "Lock the strictest-wins merge semantics + where the gateway fetches rules",
    },
    {
      title: "Gateway merge",
      detail: "Gateway evaluates org+project+agent rules with strictest-wins",
    },
    {
      title: "Team UI",
      detail:
        "Project-as-Team policy scope selector + level badges in the policy UI",
    },
    {
      title: "Verify+Commit",
      detail: "cargo test/clippy + tsc + merge proof + commit + gbrain",
    },
  ],
};

const REPO = "/Users/ttwj/Project OneComputer/implementation/onecomputer";
const GW = `${REPO}/apps/gateway/src`;
const API = `${REPO}/packages/api/src`;
const WEB = `${REPO}/apps/web/src`;

// VERIFIED SEAMS (2026-07-04):
// - PolicyRule (schema.prisma:390-419): scope String default "project"; organizationId,
//   projectId, agentId? all present. Rules ALREADY have the fields for hierarchy.
// - policy-rule-service.ts:64: agentId only set at project scope.
// - NO Team/Department model — only Organization -> Project -> Agent. Pragmatic: Project = Team.
// - Gateway policy.rs:80-166 evaluate() ranks Block>ManualApproval>RateLimit>Allow WITHIN a
//   given rule set for one request. The GAP: nothing fetches org-level + project-level +
//   agent-level rules and merges strictest-wins. The strictest-wins logic that DOES exist is
//   in protective-guardrails-service.ts (strongestEffect) and is simulator_only_not_enforced.
// - Need to confirm HOW the gateway currently loads rules for a request (which scope filter).
const CTX = `
Repo: ${REPO}
Gateway (Rust): ${GW}
API (TS): ${API}
Web: ${WEB}

HARD FACTS (verified — do not contradict):
- PolicyRule already has scope + organizationId + projectId + agentId. Do NOT add a Team model;
  Project IS the team for the demo. Surface that as "Team" in UI copy only.
- Strictest-wins EXISTS only in protective-guardrails-service.ts and is
  enforcement:"simulator_only_not_enforced". The REAL gateway (policy.rs) does not merge across
  scopes. This phase moves strictest-wins into the real enforcement path.
- Strictest-wins doctrine (CLAUDE.md): global/org sets the FLOOR; project/agent may RAISE
  controls, never weaken org. i.e. if org says block, agent cannot allow.
- No crypto here. cargo test must run WITH DATABASE_URL + SECRET_ENCRYPTION_KEY set (docs/plan/05).
`;

phase("Merge design");
const design = await agent(
  `${CTX}
## Agent 17-A: Lock the merge semantics (READ-ONLY; produce a design note)

Investigate and document (write to docs/plan/_scratch/phase-17-design.md and return):
1. HOW does the gateway currently obtain PolicyRules for an incoming request? Trace from
   forward.rs / connect.rs -> policy.rs -> the DB query (find the SQL/Prisma-equivalent read
   in the Rust side or the sync mechanism). Identify the exact filter (by org? project? agent?).
   Cite file:line.
2. Define strictest-wins across scopes precisely. Proposed: collect all rules whose scope
   applies to (org, project, agent) of the request; evaluate each; combine by the existing
   action priority Block>ManualApproval>RateLimit>Allow, where a MORE restrictive action from
   ANY applicable scope wins. Org-scope Block cannot be overridden by an agent-scope Allow.
   Confirm this matches CLAUDE.md "strictest wins / org is the floor".
3. Where to implement: extend the gateway's rule fetch to pull all applicable scopes and let
   evaluate() see the union, OR add a merge step before evaluate(). Recommend the smaller diff.
4. Backward-compat: today most rules are effectively global/project. Ensure existing behavior
   is unchanged when only one scope has rules. List the test cases that prove no regression.

Return the locked design with file:line evidence and the exact test matrix to implement.
`,
  { label: "17-A:merge-design", phase: "Merge design", effort: "high" },
);

phase("Gateway merge");
const gw = await agent(
  `${CTX}

## Agent 17-B: Implement strictest-wins across org+project+agent in the gateway

Per 17-A's locked design, implement the cross-scope merge in the REAL enforcement path
(policy.rs / the rule fetch), NOT in protective-guardrails-service.ts.

Requirements:
- Applicable rule set for a request = rules where (scope=organization AND same org) OR
  (scope=project AND same project) OR (agentId = request agent). Union them.
- Evaluate with the existing action priority; the strictest applicable action wins. Org Block
  is a hard floor.
- Add unit tests for the matrix from 17-A, including:
  * org=block, agent=allow -> BLOCK (org floor holds)
  * org=allow(none), project=manual_approval -> MANUAL_APPROVAL
  * agent-specific rate_limit + project allow -> RATE_LIMIT
  * no applicable rules -> ALLOW (unchanged default)
  * single-scope-only cases match today's behavior (regression guard)
- Keep clippy clean.

Run WITH env (docs/plan/05):
  export PATH="$HOME/.cargo/bin:$PATH"; cd ${REPO} && set -a && source .env && set +a
  DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer" cargo test --manifest-path apps/gateway/Cargo.toml
  cd ${REPO}/apps/gateway && cargo clippy -- -D warnings
PASTE real output. Return files changed + results.
`,
  { label: "17-B:gateway-merge", phase: "Gateway merge", effort: "high" },
);

phase("Team UI");
const ui = await agent(
  `${CTX}

## Agent 17-C: Project-as-Team policy scope UI

In the policy/rules UI (apps/web .../rules or settings/policy):
- When creating/viewing a policy, show a "Level" selector: Enterprise (org) / Team (project) /
  User (agent), mapping to scope=organization / project + projectId / agentId.
- Render a level badge on each rule row: "Enterprise", "Team: <projectName>", "User: <agent>".
- Copy note: "Team = project scope. Enterprise policies set the floor; teams and users can
  only make rules stricter, never weaker." (matches strictest-wins doctrine).
- If members/roles pages from phase-9 exist, link a manager to "set a Team policy" from there.

Do NOT change the API rule schema (fields already exist). Wire the selector to the existing
POST /v1/rules with the right scope/projectId/agentId.

Run tsc. Return files changed + tsc result + http code for the rules/policy page.
`,
  { label: "17-C:team-ui", phase: "Team UI" },
);

phase("Verify+Commit");
const commit = await agent(
  `${CTX}

## Agent 17-D: Verify + commit

PASTE real output:
  export PATH="$HOME/.cargo/bin:$PATH"; cd ${REPO} && set -a && source .env && set +a
  DATABASE_URL="postgresql://onecomputer:onecomputer@localhost:5433/onecomputer" cargo test --manifest-path apps/gateway/Cargo.toml
  cd ${REPO}/apps/gateway && cargo clippy -- -D warnings
  cd ${REPO}/apps/web && npx tsc --noEmit

Only commit if cargo test (env set), clippy, tsc all clean AND the strictest-wins matrix
tests pass:
  cd ${REPO}
  git add -A apps/gateway/ apps/web/ packages/api/ docs/plan/
  git commit -m "feat(policy): strictest-wins org/project/agent merge in the gateway

Move cross-scope policy merge into the real enforcement path (policy.rs): a request
now sees org + project + agent rules, strictest action wins, org is the floor
(previously strictest-wins lived only in the simulator_only guardrails service).
Project surfaced as 'Team' in the policy UI with Enterprise/Team/User level badges.
Demo beats 1 and 2.

cargo test (env set) + clippy + tsc: clean

Co-Authored-By: Claude <noreply@anthropic.com>"

Append dated result to gbrain ~/brain/projects/onecomputer-build-priorities.md (do NOT run
gbrain import — key broken). Update STATE.md + docs/plan/06 (this closes risk-register R.. on
strictest-wins not being enforced).
Return commit hash + pasted output.
`,
  { label: "17-D:verify-commit", phase: "Verify+Commit" },
);

return { design, gw, ui, commit };
