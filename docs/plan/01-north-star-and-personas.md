# 01 — North Star and Personas

## North Star

ONEComputer is the enterprise control plane for AI employees: governed sandboxes, credential custody, package gating, policy enforcement, human approvals, VTI identity, and evidence for every agent action.

The investor demo should prove one sentence:

> An employee can boot a Claude Code sandbox, the agent can attempt a sensitive enterprise action, a manager can approve it through a VTI-backed 2FA flow, and Cyber can see and stop everything.

## Personas

### 1. Cyber / Compliance

**Who:** CISO, security ops, compliance officer.  
**Primary surface:** `/console`, `/activity`, `/rules`.  
**Job:** Monitor all sandboxes and agents, enforce policies, export evidence, kill compromised resources.

Needs:

- org-wide sandbox fleet
- all agents and owners
- policy violations
- kill switch
- evidence export
- package gate status
- connector risk posture

### 2. Manager

**Who:** Business unit manager or team lead.  
**Primary surface:** `/approvals`.  
**Job:** Approve/deny sensitive actions performed by employee agents.

Needs:

- pending approval queue
- clear human-readable action summary
- countdown/expiry
- approve/deny buttons
- team activity summary
- VTI step-up proof context

### 3. Employee

**Who:** Developer, analyst, operator managing many Claude Code agents/apps.  
**Primary surface:** `/sandboxes`, `/agents`, `/connections`.  
**Job:** Boot sandboxes, run Claude Code, connect approved tools, deploy work.

Needs:

- boot sandbox
- run command
- see Claude version/status
- install/connect tools
- understand why something is blocked
- request approval when needed

### 4. Platform Owner

**Who:** Enterprise platform owner, CIO team, AI transformation team.  
**Primary surface:** `/apps`, `/settings/members`, `/settings/roles`.  
**Job:** Deploy governed apps, manage users/roles, show business value.

Needs:

- app deploy wizard
- app passport
- governed URL
- member/role management
- package gate setup
- enterprise onboarding

## Product wedge

The narrow wedge is:

```text
Claude Code in a governed enterprise sandbox
+ manager approval for risky actions
+ Cyber-visible evidence
```

This wedge is strong because it maps directly to the current enterprise anxiety:
workers are already using Claude/Codex/agents, but IT/Cyber has no control plane.
