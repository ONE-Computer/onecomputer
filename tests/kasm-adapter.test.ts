import assert from "node:assert/strict";
import test from "node:test";
import { mapKasmState } from "@onecomputer/kasm-adapter";

test("Kasm operational states map to the canonical sandbox contract", () => {
  assert.equal(mapKasmState("running"), "ready");
  assert.equal(mapKasmState("starting"), "provisioning");
  assert.equal(mapKasmState("stopped"), "stopped");
  assert.equal(mapKasmState("error"), "failed");
});
