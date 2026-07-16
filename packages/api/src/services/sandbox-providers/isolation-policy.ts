/**
 * Production isolation policy for sandbox-provider selection.
 *
 * Kasm and Daytona are useful development providers, but neither currently
 * returns a hardware-virtualized isolation attestation. An operator may set
 * ONECOMPUTER_REQUIRE_ATTESTED_ISOLATION=1 to make the control plane fail
 * closed until an attested provider is registered. This switch is deliberately
 * explicit and is not inferred from NODE_ENV or a UI label.
 */

export const requiresAttestedIsolation = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => env.ONECOMPUTER_REQUIRE_ATTESTED_ISOLATION === "1";

export const assertSandboxProviderAllowed = (
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (!requiresAttestedIsolation(env)) return;

  // No provider currently registered by this repository satisfies the
  // attestation contract. Keep this explicit until a Firecracker/Kata/Cloud
  // Hypervisor adapter returns signed isolation evidence.
  throw new Error(
    `Sandbox provider ${provider} is not accepted when attested isolation is required`,
  );
};
