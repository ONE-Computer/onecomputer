const chromiumPattern = /\b(?:Chrom(?:e|ium)|Edg|Brave)\//;

export function clipboardStatusForBrowser(capability, environment = {
  isSecureContext: globalThis.isSecureContext,
  userAgent: globalThis.navigator?.userAgent ?? "",
  hasClipboardApi: Boolean(globalThis.navigator?.clipboard?.readText && globalThis.navigator?.clipboard?.writeText),
}) {
  if (!capability || capability.status === "policy_disabled") {
    return {
      state: "policy_disabled",
      message: "Clipboard sharing is disabled by your workspace policy.",
    };
  }
  if (!environment.isSecureContext || !environment.hasClipboardApi || !chromiumPattern.test(environment.userAgent)) {
    return {
      state: "unsupported",
      message: "This browser needs the Kasm clipboard panel. Native copy and paste is supported in Chrome, Edge, Chromium, and Brave.",
    };
  }
  return {
    state: "ready",
    message: "Native copy and paste is ready. Allow clipboard access in the workspace tab if your browser asks.",
  };
}
