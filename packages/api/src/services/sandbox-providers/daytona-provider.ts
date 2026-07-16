import * as daytona from "../daytona-service";
import type { SandboxInfo, SandboxProvider } from "./types";
import {
  captureX11Screenshot,
  ensureVisualRuntime,
} from "../sandbox-visual-runtime";

const normalize = (sandbox: daytona.SandboxInfo): SandboxInfo => ({
  ...sandbox,
  provider: "daytona",
});

export const daytonaProvider: SandboxProvider = {
  createSandbox: async (name) => normalize(await daytona.createSandbox(name)),
  listSandboxes: async () => (await daytona.listSandboxes()).map(normalize),
  getSandbox: async (id) => normalize(await daytona.getSandbox(id)),
  execInSandbox: daytona.execInSandbox,
  deleteSandbox: daytona.deleteSandbox,
  getSandboxDesktop: daytona.getSandboxDesktop,
  restartSandboxDesktop: async (id) => daytona.restartSandboxDesktop(id),
  ensureVisualRuntime: (id) => ensureVisualRuntime(id, daytona.execInSandbox),
  captureScreenshot: (id) => captureX11Screenshot(id, daytona.execInSandbox),
};
