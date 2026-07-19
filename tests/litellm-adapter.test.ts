import assert from "node:assert/strict";
import test from "node:test";
import { LiteLLMGatewayAdapter } from "@onecomputer/litellm-adapter";

const adapter = new LiteLLMGatewayAdapter({
  adminUrl: "http://litellm.internal:4000",
  workspaceUrl: "http://litellm:4000",
  masterKey: "sk-master-test-not-used-00001",
  credentialSecret: "credential-secret-for-tests-00000001",
});

test("workspace credentials are deterministic, scoped by workspace, and not the master key", () => {
  const first = adapter.credentialFor("workspace-a");
  assert.equal(first, adapter.credentialFor("workspace-a"));
  assert.notEqual(first, adapter.credentialFor("workspace-b"));
  assert.notEqual(first, "sk-master-test-not-used-00001");
  assert.match(first, /^sk-ocw-[A-Za-z0-9_-]+$/);
});
