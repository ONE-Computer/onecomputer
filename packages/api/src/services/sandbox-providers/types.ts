import type {
  DesktopHealth,
  DesktopStatus,
} from "../sandbox-desktop-bootstrap";

export interface SandboxInfo {
  id: string;
  name: string;
  state: string;
  provider: "daytona" | "kasm-local";
  toolboxUrl?: string;
  claudeVersion?: string;
  bootstrapped: boolean;
  desktopUrl?: string;
  desktopReady?: boolean;
  desktopHealth?: DesktopHealth;
  bootLogTail?: string;
  createdAt?: string;
}

export interface ExecResult {
  exitCode: number;
  output: string;
}

export interface SandboxRuntimeOptions {
  /** Agent proxy credential held by the gateway; never expose in the UI. */
  gatewayAgentToken?: string;
}

export type SandboxDesktopInfo = DesktopStatus & {
  sandboxId: string;
  status: string;
};

export interface SandboxProvider {
  createSandbox(
    name: string,
    options?: SandboxRuntimeOptions,
  ): Promise<SandboxInfo>;
  /**
   * Optional long-running setup after a stable provider identity has been
   * persisted. Create must return before this work starts so cancellation can
   * always address the sandbox by ID.
   */
  bootstrapSandbox?(
    id: string,
    options?: SandboxRuntimeOptions,
  ): Promise<SandboxInfo>;
  listSandboxes(): Promise<SandboxInfo[]>;
  getSandbox(id: string): Promise<SandboxInfo>;
  execInSandbox(id: string, command: string): Promise<ExecResult>;
  deleteSandbox(id: string): Promise<void>;
  getSandboxDesktop(id: string): Promise<SandboxDesktopInfo>;
  restartSandboxDesktop(
    id: string,
    options?: SandboxRuntimeOptions,
  ): Promise<SandboxDesktopInfo>;
}
