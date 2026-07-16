import { createApiApp } from "@onecli/api";
import { nextSessionProvider } from "./session-provider";
import { cloudOverrides } from "@/lib/init/api";

// Injected only by the controlled deployment script. It is intentionally
// public health metadata, never a credential or tenant identifier.
export const app = createApiApp(nextSessionProvider, {
  ...cloudOverrides,
  version: process.env.ONECOMPUTER_BUILD_VERSION,
});
