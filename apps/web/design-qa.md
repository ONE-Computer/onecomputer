# ONEComputer employee workspace design QA

- Source visual truth: `/home/mike/.codex/generated_images/019f7918-cc7a-7012-bb4f-d4198279dab9/exec-30c950f5-9a08-4491-81eb-86a701277af8.png`
- Implementation screenshot: `/home/mike/Documents/onecomputer/apps/web/.artifacts/home-1440x1024-final.png`
- Responsive screenshot: `/home/mike/Documents/onecomputer/apps/web/.artifacts/home-390x844-final.png`
- Viewport: `1440 × 1024` desktop, with a `390 × 844` responsive check
- State: employee Home screen; workspace ready; no panel open
- Full-view comparison evidence: `/home/mike/Documents/onecomputer/apps/web/.artifacts/comparison-final.png`
- Focused comparison evidence: `/home/mike/Documents/onecomputer/apps/web/.artifacts/comparison-focused-final.png`

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: Inter Variable closely preserves the selected mock's Segoe-like Windows familiarity, hierarchy, wrapping, and optical weight. The live wordmark is marginally heavier than the generated reference; this is acceptable P3 polish until the real brand asset exists.
- Spacing and layout rhythm: the 246px navigation rail, centered content column, workspace/readiness grouping, button proportions, support-column split, dividers, and vertical rhythm match the visual target. The implementation is slightly denser in small support text, without changing hierarchy or usability.
- Colors and visual tokens: warm-white base, pale navigation surface, navy actions, green readiness, amber pending state, and low-contrast separators align with the reference and maintain readable contrast.
- Image quality and asset fidelity: the source contains no photographic or illustrative content. Fluent System Icons supply a coherent Windows-familiar icon family; no placeholder imagery, custom SVG, CSS illustration, or raster substitution is present.
- Copy and content: all primary source copy is preserved, with additional product copy limited to interactive states and secondary panels.
- Accessibility and behavior: semantic navigation, headings, regions, dialog labeling, visible focus, Escape-to-close, dialog focus entry/restoration, reduced-motion handling, disabled restart states, and live status messages were checked.
- Responsiveness: the desktop composition collapses to a readable mobile flow at 390px with no horizontal overflow, clipped controls, or off-screen primary action.

## Interaction verification

- Open workspace changes the title, supporting copy, CTA label, and live status.
- Restart exposes an honest checking state, disables conflicting actions, and returns to ready.
- Home, Activity, and Help navigation works on desktop and through the mobile menu.
- Capability details and governed-operation details open as dismissible panels.
- The governed-operation panel reports approval status without offering browser-side approval.
- Browser console completed with no errors, warnings, or issues after the final pass.

## Comparison history

### Pass 1

- Full-view and focused comparisons found no P0/P1/P2 visual mismatch.
- One non-visual accessibility issue was found: panel focus initially remained on the triggering control.
- Fix: panels now move focus to Close on entry and restore focus to the triggering control on Escape or close.
- Post-fix evidence: browser accessibility snapshot confirmed focus on `Close panel`, then restored focus on `View all capabilities` after Escape. Final desktop and responsive captures remained visually aligned.

## Follow-up polish

- P3: replace the live text wordmark when an official ONEComputer brand asset is available.
- P3: tune the smallest support-copy weights after the real product type scale is established.

## Implementation checklist

- [x] Match the selected desktop composition and content hierarchy.
- [x] Implement primary workspace and governed-operation interactions.
- [x] Verify mobile navigation and responsive layout.
- [x] Check keyboard focus, reduced motion, and console output.
- [x] Compare source and implementation together at full and focused views.

## Issue 009 browser approval extension

- The Approval device card reuses the established Connections card, button,
  status-chip, typography, spacing, and responsive patterns.
- Live Chrome inspection covered the desktop Connections view and a 390 × 844
  mobile viewport. The card and pending-approval details stack without clipping
  or horizontal overflow.
- The enrollment, refresh, approve, deny, and removal actions expose semantic
  buttons and live status text. No private key, transport token, or unrestricted
  Microsoft payload is rendered.
- Lighthouse reported 100 for accessibility and 100 for best practices on the
  mobile view. No actionable P0, P1, or P2 visual findings remain.
- The physical WebAuthn prompt and signed approve/deny path remain Issue 009
  acceptance checks because they require the user's real browser authenticator.

### Physical approval UX review

- Evidence: `/home/mike/.codex/attachments/cb9d2c6a-4f55-49fa-980c-35211a247b97/codex-clipboard-34611e4e-b623-470c-bcec-de91ebc0c6e8.png`
  and `/home/mike/.codex/attachments/96f11481-15be-4d00-8250-5742538cee86/codex-clipboard-4ebfc0e4-7161-4bf5-8f17-14fcc261277e.png`.
- Step 1, pending operation: visually clear and correctly status-only, but the
  extra navigation to Connections plus one device prompt to view and another to
  decide created avoidable high-friction approval.
- Step 2, completed operation: healthy. The final state and exactly-once result
  are clear in the recent-operation row.
- Resolution: the signed safe request now loads automatically in the governed
  operation drawer through the signed-in ONEComputer session. Approve or deny
  requires one WebAuthn signing gesture; Connections is device management only.
- Accessibility limit: screenshots establish hierarchy and visible states, not
  keyboard, screen-reader, or authenticator-dialog behavior. Those remain live
  browser checks for the revised pending state.

final result: passed
