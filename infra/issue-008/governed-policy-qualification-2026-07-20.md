# Issue 008 governed MCP policy qualification — 2026-07-20

## Result

**Implementation pass; final disposable-file execution awaits human review.**

The pinned LiteLLM `v1.93.0` MCP dispatcher invokes the owned callback again
after it has resolved the key, server, tool, and arguments and before OAuth
resolution/upstream dispatch. The earlier route-parsing hook has empty tool
fields and is ignored; authority is applied only to the resolved invocation.
The callback independently binds the key's single allowed MCP server ID.

## Automated evidence

- repository build passed;
- 58/58 tests passed;
- exact assigned bounded reads allow;
- `$top=26`, `fetchAllPages`, policy hash mutation, wrong server/tool, and
  unknown arguments deny;
- a delete request persists an approval-required operation before execution;
- the operation binds drive ID, item ID, `If-Match`, policy, schema, nonce,
  expiry, and exact execution arguments;
- exact execution lease dispatch succeeds once in the store test;
- replay and argument mutation deny;
- secrets and request bodies remain redacted from Control logs.

## Live local evidence

| Probe | Result |
| --- | --- |
| Assigned `list-mail-folders` through sandbox -> LiteLLM -> Control -> Softeria | Allowed and completed |
| Control callback receipt | Internal authorization request completed before the provider result |
| `list-mail-folders` with `{ "top": 26 }` | Denied with `MCP_ARGUMENTS_OUT_OF_POLICY` |
| Control container stopped | Read denied with `MCP_POLICY_UNAVAILABLE`; no fallback |
| Control restored | Bounded calendar read completed |
| Policy promotion | Local assignment moved immutably from version 1 to version 2 with the original four-tool surface; the final five-tool policy adds bounded OneDrive discovery for item/eTag binding |
| Final local assignment | Version 3, `5719ab73-6780-4cd2-8ed3-ee9a1f8e6e2b`, hash `3b0b1e2f24422ea841ac6e940448a61d67e642c3968d007a6f929800fe794b87` |
| Synthetic nonexistent delete target | Returned `MCP_APPROVAL_REQUIRED` and a durable operation ID |
| Synthetic operation decision | Denied; receipt remained null, proving zero approved execution |

The live output was inspected only for success/error classification. Microsoft
mail/calendar content and OAuth material were not copied into this record.

## Human completion gate

1. Disconnect and reconnect Microsoft 365 as `mike@metech.dev` so the stored
   delegated grant includes `Files.ReadWrite`.
2. Restart the workspace from the ONEComputer UI so its agent environment
   receives policy version 3 and the five-tool surface.
3. Create a disposable OneDrive file. Use `list-drives`, then the bounded
   `search-onedrive-files`, to retrieve its drive/item ID and eTag. Request
   `delete-onedrive-file` without `confirm`.
4. Confirm Microsoft is untouched while the operation says
   `approval_required`.
5. Approve once in the local fixture drawer; confirm the disposable file is
   deleted once and a safe receipt appears.
6. Retry the exact call and mutate the item/eTag; both must deny and must not
   delete anything else.

This human gate is intentionally retained because the system must not choose
or delete a real user document on its own.
