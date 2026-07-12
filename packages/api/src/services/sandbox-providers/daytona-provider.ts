import * as daytona from "../daytona-service";
import type {
  SandboxInfo,
  SandboxProvider,
  SandboxRuntimeOptions,
} from "./types";

const normalize = (sandbox: daytona.SandboxInfo): SandboxInfo => ({
  ...sandbox,
  provider: "daytona",
});

export const daytonaProvider: SandboxProvider = {
  createSandbox: async (name, _options?: SandboxRuntimeOptions) =>
    normalize(await daytona.createSandbox(name)),
  listSandboxes: async () => (await daytona.listSandboxes()).map(normalize),
  getSandbox: async (id) => normalize(await daytona.getSandbox(id)),
  execInSandbox: daytona.execInSandbox,
  deleteSandbox: daytona.deleteSandbox,
  getSandboxDesktop: daytona.getSandboxDesktop,
  restartSandboxDesktop: async (id, _options?: SandboxRuntimeOptions) =>
    daytona.restartSandboxDesktop(id),
};
