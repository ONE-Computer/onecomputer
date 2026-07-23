import assert from "node:assert/strict";
import test from "node:test";
import { clipboardStatusForBrowser } from "../apps/web/src/clipboard-status.js";

const capability = {
  status: "available",
  reasonCode: "CLIPBOARD_READY",
  mode: "native",
  localToWorkspace: true,
  workspaceToLocal: true,
  mimeTypes: ["text/plain"],
  maxBytes: 65_536,
  requiresUserGesture: true,
  supportedBrowsers: ["chromium"],
  fallback: "kasm-control-panel",
};

test("clipboard status distinguishes ready, unsupported, and policy-disabled launches", () => {
  assert.equal(clipboardStatusForBrowser(capability, {
    isSecureContext: true,
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
    hasClipboardApi: true,
  }).state, "ready");
  assert.equal(clipboardStatusForBrowser(capability, {
    isSecureContext: true,
    userAgent: "Mozilla/5.0 Firefox/141.0",
    hasClipboardApi: true,
  }).state, "unsupported");
  assert.equal(clipboardStatusForBrowser(capability, {
    isSecureContext: false,
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
    hasClipboardApi: true,
  }).state, "unsupported");
  assert.equal(clipboardStatusForBrowser({
    ...capability,
    status: "policy_disabled",
    reasonCode: "CLIPBOARD_POLICY_DISABLED",
  }, {
    isSecureContext: true,
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
    hasClipboardApi: true,
  }).state, "policy_disabled");
});
