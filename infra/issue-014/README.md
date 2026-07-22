# Issue 014 UI-only golden-path runbook

This runbook is the human acceptance surface for Issue 014. It uses only the
ONEComputer web UI and the managed Claude Desktop workspace. LiteLLM admin,
direct Graph calls, database edits, and the qualification CLI are not part of
the accepted journey.

## Safe preparation

- Use a dedicated Microsoft 365 test account and uniquely named disposable
  mail, calendar, OneDrive, and Teams data.
- Record the source revision, workspace profile version, selected model alias,
  active policy version/hash, connector version, and OpenVTC protocol version.
- Capture only redacted screenshots. Never capture OAuth tokens, API keys,
  approval private keys, cookies, message bodies, event bodies, or file
  contents.
- Begin with the workspace stopped and Microsoft 365 disconnected. Keep the
  same ordinary browser profile open for the complete approval-device test.

## Journey

| Step | Human action | Required visible result |
| --- | --- | --- |
| 1 | Sign in to ONEComputer and open **Sandbox**. Select the approved Claude Desktop profile and model route, save, and start it. | Home reports Identity, Network, Models, and Tools ready. The sandbox exposes only the selected alias and assigned tools. |
| 2 | Open **Connections**, connect Microsoft 365, and complete OAuth as the test user. | ONEComputer shows the expected account connected without exposing a token to the workspace. |
| 3 | In Claude Desktop, ask harmless natural-language questions about recent Mail, Calendar, OneDrive, and Teams data. | The agent invokes the assigned read tools and returns bounded results. No approval is raised for tools currently set to Allow. |
| 4 | Create uniquely named disposable examples through the agent: a Mail draft or send, a Calendar event, a OneDrive file lifecycle action, and a Teams send or reply. | Each tool follows its current ONEComputer policy. Protected writes create a governed operation before any provider mutation. |
| 5 | In **Admin**, change one disposable write tool from Require approval to Block and another from Require approval to Allow. Save the complete policy. | New calls use the new policy. An already-pending operation retains its original policy version and decision. |
| 6 | Trigger a protected OneDrive delete, review the operation, and approve it with the enrolled browser device. Trigger a second disposable delete and deny it. | The approved action executes exactly once and the waiting agent observes completion. The denied action executes zero times. Chat, operation, and audit views agree. |
| 7 | Inspect **Activity** and operation details, then stop/start the workspace and restart the documented local services. Repeat a fresh protected action with the same browser profile. | Identity, policy attribution, approval-device binding, redacted audit evidence, and exactly-once behavior survive restart without reissuing credentials to the workspace. |
| 8 | Delete all disposable data and remove temporary policy exceptions through supported UI paths. Disconnect Microsoft 365 if the test requires a clean ending. | No disposable resource, pending approval, temporary grant, or leaked authority remains. |

## Evidence checklist

- [ ] Numbered screenshots correspond to all eight steps.
- [ ] Mail, Calendar, OneDrive, and Teams reads were invoked by natural language.
- [ ] At least one governed write outside OneDrive was observed.
- [ ] Allow, Require approval, and Block produced distinct visible effects.
- [ ] Existing pending operation remained bound to its original policy version.
- [ ] Approved delete executed exactly once; denied delete executed zero times.
- [ ] The waiting agent observed approval completion without a second user tool request.
- [ ] The same approval browser remained enrolled across reload and service/workspace restart.
- [ ] Audit evidence was redacted and correlated agent, tool, policy, operation, approval, and provider receipt.
- [ ] Cleanup inventory is empty.

Issue 014 remains in verification until every checkbox is supported by human-
reviewed evidence. Deferred Issue 012 and Issue 013 checks are included here so
they cannot be silently lost at final acceptance.
