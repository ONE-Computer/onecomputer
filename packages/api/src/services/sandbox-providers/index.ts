import { daytonaProvider } from "./daytona-provider";
import { kasmLocalProvider } from "./kasm-local-provider";
import type { SandboxProvider } from "./types";

export type {
  SandboxInfo,
  SandboxProvider,
  SandboxDesktopInfo,
  SandboxRuntimeOptions,
} from "./types";

export function getSandboxProvider(): SandboxProvider {
  const provider = process.env.SANDBOX_PROVIDER ?? "daytona";
  if (provider === "daytona") return daytonaProvider;
  if (provider === "kasm-local") return kasmLocalProvider;
  throw new Error(`Unsupported SANDBOX_PROVIDER=${provider}`);
}
