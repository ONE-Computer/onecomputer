# CEO Review — AWS Cloud PC / Claude Cowork Hardening

Date: 2026-06-21 SGT
Mode: gstack CEO review, selective expansion
Canonical product: OneComputer
Pilot/reference customer: InvestmentGini

## Verdict

This is real and strategically important. Keep it inside OneComputer, but do not let it derail the current VTI/CISO 95-readiness runner.

The right framing is not “spin up a Windows VM.” The right framing is:

> OneComputer can provide governed cloud computers for humans and AI agents, with Excel, Claude/Cowork, enterprise credentials, egress controls, screenshots, kill switch, and evidence built in.

That is a much bigger category than secure deployment of Streamlit/React apps. It also solves a different pain: enterprise users need a safe place to run desktop workflows, not just web apps.

## What changed after studying the existing research

The prior AWS Secure Cowork research is stronger than I expected. It already proves several non-obvious things:

1. AWS WorkSpaces Applications/AppStream is viable as the managed desktop substrate.
2. Excel launches in the image-builder session.
3. Claude installs in Administrator image-builder context.
4. Claude can pick up Foundry policy and show “Welcome to Claude on Foundry.”
5. The correct path is golden image build, not live fleet install.
6. Agent Access MCP is the right control/evidence surface, not brittle Playwright-over-streaming.

Current sandbox status checked on 2026-06-21 around 20:05 SGT:

```text
Images:
- invgini-secure-cowork-excel-claude-20260621-1507        PENDING
- invgini-secure-cowork-excel-claude-20260621-rebuild1901 PENDING

Image builders:
- invgini-secure-cowork-poc-builder       SNAPSHOTTING
- invgini-secure-cowork-poc-builder2-1901 SNAPSHOTTING
```

Both images still have `Excel` and `ClaudeFoundry` registered and no state-change error at the time of check.

## CEO-level product decision

### Include as a OneComputer product surface

Yes. This should be a first-class OneComputer product surface:

- **OneComputer Apps**: deploy vibe-coded Streamlit, Node, React apps.
- **OneComputer Agents**: governed autonomous Claws with identity, policy, and evidence.
- **OneComputer Cloud PCs**: governed desktops for Excel, Claude/Cowork, browser apps, and human-in-the-loop workflows.

But order matters. The app deployment path is still the best wedge because it is lighter, cheaper, and easier to demo. The cloud PC path is the premium enterprise expansion.

### Do not reframe the whole company around Windows VMs

The danger is becoming a VDI/AppStream integrator. That is a trap. The OneComputer differentiation is not the Windows VM. The differentiation is the trust/control plane:

- identity
- consent
- policy
- credentials
- egress
- evidence
- approvals
- kill switch
- VTI/Affinidi trust artifacts

AWS should be the runtime substrate, not the product identity.

## Strongest strategic thesis

Shadow IT is not only random web apps. It is also local desktop automation:

- Excel macros
- Claude Desktop/Cowork
- browser sessions
- local files
- personal laptops
- Mac minis
- local Claws

Corporate IT cannot govern this if it stays on unmanaged user machines. OneComputer Cloud PC gives them a controlled place to say yes.

The buyer message:

> “Stop banning AI desktop workflows. Move them into governed cloud computers with evidence, egress control, and revocation.”

## What is great about the AWS route

### 1. It meets users where they are

Business users understand desktops, Excel, browsers, and Claude. This reduces adoption friction versus asking them to use a new abstract agent console.

### 2. It creates a safe place for messy workflows

Many workflows are not API-clean. They involve spreadsheets, portals, screenshots, PDFs, forms, and human judgment. A governed desktop handles these better than pure backend automation.

### 3. It gives CISO a containment story

Instead of unmanaged laptops and copy/paste into personal AI, OneComputer can offer:

- no secrets baked into images;
- runtime secret injection;
- egress allowlists;
- screenshot/evidence capture;
- admin session kill switch;
- policy-bound connector access;
- VTI-shaped grants later.

### 4. Agent Access MCP is a leverage point

The managed MCP control surface means OneComputer can automate desktop workflows without building its own remote desktop controller.

## What worries me

### 1. AppStream image build lifecycle can be operationally weird

The current images are still `PENDING` and builders are `SNAPSHOTTING`. This may resolve, but it highlights a real risk: image-building is slower and more stateful than app deployment.

Mitigation: treat Cloud PC as a slower premium runtime, not the main wedge.

### 2. Agent Access is still a new/preview surface

Good for POC and demos. For enterprise promises, we need clear fallback paths: human streaming URL, EC2 + DCV, or WorkSpaces Personal/Pools.

### 3. License and identity complexity will dominate

Excel/Office, Claude Desktop, Foundry policy, Microsoft 365, corporate SSO, and AppStream user identity all have different policy surfaces. This can drown the product if we start here.

Mitigation: first pilot should use license-included Office LTSC and one managed Foundry policy, not full enterprise M365 BYOL.

### 4. Security story must be stricter than normal VDI

If the desktop has browser access and Claude access, CISO will ask:

- Can user upload files to personal webmail?
- Can Claude access uncontrolled websites?
- Are screenshots retained?
- Can admin revoke session instantly?
- Are clipboard and downloads controlled?
- Where are secrets stored?
- What data leaves the VPC?

If we cannot answer these, the demo becomes scary.

## Recommended sequencing

### Now: keep VTI 95-readiness runner as the mainline

Do not derail P1/P2/P3. The durable registry, App Passport, policy artifacts, evidence chain, and gateway verifier are needed by both app deployment and Cloud PC.

### Parallel low-noise task: monitor AWS image status

Schedule or manually check the two AppStream images. When the rebuild image becomes `AVAILABLE`, finish the proof:

1. Create/update AppStream fleet from rebuild image.
2. Launch fresh runtime session.
3. Validate Excel.
4. Validate Claude Foundry.
5. Capture Agent Access screenshots.
6. Export safe evidence pack.

### After current 95 path reaches stable checkpoint: make Cloud PC a product module

Create a `WorkspaceRuntime` abstraction:

```text
OneComputer Control Plane
  -> AppRuntime: Streamlit / Node / React
  -> AgentRuntime: Claws / scheduled agents
  -> WorkspaceRuntime: AWS AppStream / WorkSpaces / EC2+DCV
```

The same passport/policy/grant/evidence model should govern all three.

## 10-star version

A user clicks “Launch Secure Cowork.” In less than a minute:

1. A browser-streamed Windows desktop opens.
2. Excel is ready.
3. Claude is ready and already configured to enterprise Foundry.
4. User never sees or handles API keys.
5. Corporate data sources are available only through approved connectors.
6. Egress is deny-by-default.
7. The CISO dashboard shows live session, policy, grants, evidence, and kill switch.
8. An agent can assist through Agent Access MCP.
9. The whole session produces a tamper-evident evidence pack.

## The hard “do not do” list

Do not:

- promise general Windows VDI management;
- support every desktop app initially;
- build our own remote desktop protocol;
- bake real API keys into images;
- rely on browser-streaming Playwright automation for production control;
- mix this into InvestmentGini as if it were a one-off feature;
- start full M365 BYOL/SSO complexity before the simple Foundry/Office LTSC POC proves value.

## CEO recommendation

**Selective expansion.** Keep app deployment and VTI/CISO readiness as the mainline. Add Cloud PC as a queued premium product surface under OneComputer, with one immediate background action: monitor the AppStream image build and finish the fresh-session proof when available.

If the fresh-session proof succeeds, this becomes a very powerful demo for Head of Digital Transformation and CISO:

> “We can give your teams approved AI computers, not just approved AI chat.”

That is a better enterprise story than yet another dashboard.
