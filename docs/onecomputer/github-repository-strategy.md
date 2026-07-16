# GitHub repository strategy

Updated 2026-07-12 after the initial `ONE-Computer` organization setup.

## Published repositories

- [ONEComputer product](https://github.com/ONE-Computer/onecomputer) — public,
  curated product snapshot from the OpenVTC integration line.
- [Organization site](https://github.com/ONE-Computer/one-computer.github.io) —
  public static GitHub Pages site at
  [one-computer.github.io](https://one-computer.github.io/).

The product repository was published from one sanitized initial commit. The
old Gitea development history remains available for internal continuity but is
not exposed as the public GitHub history. This avoids publishing stale agent
workflows, internal deployment assumptions, and historical detector hits.

## OpenVTC forks

The following public forks preserve upstream ancestry and are the organization
integration points:

- `openvtc`
- `verifiable-trust-infrastructure`
- `vta-browser-plugin`
- `vta-mobile-agent-ios`
- `vti-didcomm-js`
- `vti-push-gateway`
- `vti-setup`
- `rp-sdk-js`
- `dtg-credentials`
- `governance`
- `wiki`
- `dtgwg-trust-tasks-tf` (upstream TrustOverIP)

The iOS fork includes the local ONEComputer mobile-wallet adapter commits
`cb8f1ed` and `710c8d6`. Unmodified forks remain aligned with upstream.

## Dependency boundary

These are not currently forked because they are dependencies or references,
not ONEComputer-owned product code:

- `affinidi-tdk-rs` — consume pinned crates/releases;
- `daytona-oss` — sandbox provider/reference;
- `tgw-reference` — protocol/reference implementation;
- `dom-to-pptx`, `graphify`, and `pptxgenjs` — supporting tooling;
- AppStream, secure Claude computer, and Windows experiment repositories —
  historical or experimental lanes.

Fork one of these only when ONEComputer carries a maintained patch that cannot
be upstreamed; otherwise pin the upstream version and record the boundary.

## History policy

1. Never rewrite an upstream OpenVTC fork merely to improve commit wording.
   Preserve upstream ancestry so syncing and security review continue to work.
2. Keep product history professional from the public import boundary onward:
   use small, technical commits, no credentials, no internal host details, and
   no speculative readiness claims.
3. Keep the full historical product archive private/internal. If a public
   history rewrite is ever required, create a reviewed sanitized export, run
   secret scanning on the tree and all commits, and force-push only before
   announcing the repository as a stable public source.
4. Never use GitHub Push Protection bypass links for a real or ambiguous secret.
   Remove or rotate it, then rescan the complete history.
5. Use GitHub Actions for GitHub validation and deployment. Keep Azure runtime
   secrets in the secret manager; do not copy Gitea runner credentials or local
   `.env` files into GitHub.

## Promotion flow

```text
local branch
  -> tests and gitleaks
  -> pull request in ONE-Computer/onecomputer
  -> GitHub Actions
  -> reviewed merge to main
  -> Azure deployment from the exact merge SHA
  -> hosted E2E evidence
```
