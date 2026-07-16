import { describe, expect, it } from "vitest";
import {
  assertSandboxProviderAllowed,
  requiresAttestedIsolation,
} from "./isolation-policy";

describe("sandbox isolation policy", () => {
  it("keeps development providers available when the guard is not enabled", () => {
    expect(requiresAttestedIsolation({})).toBe(false);
    expect(() => assertSandboxProviderAllowed("kasm-local", {})).not.toThrow();
  });

  it("fails closed for current providers when attestation is required", () => {
    const env = { ONECOMPUTER_REQUIRE_ATTESTED_ISOLATION: "1" };
    expect(requiresAttestedIsolation(env)).toBe(true);
    expect(() => assertSandboxProviderAllowed("kasm-local", env)).toThrow(
      "not accepted when attested isolation is required",
    );
    expect(() => assertSandboxProviderAllowed("daytona", env)).toThrow(
      "not accepted when attested isolation is required",
    );
  });
});
