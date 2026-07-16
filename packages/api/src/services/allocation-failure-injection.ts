/**
 * Deliberately injects one post-persistence allocation response failure for a
 * controlled development-provider recovery test.
 *
 * This hook is inert unless both flags are explicitly enabled, and it is
 * always disabled in production. It must never be used as a production
 * availability mechanism or as an authorization boundary.
 */
let injected = false;

export const consumeAllocationResponseFailure = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (env.NODE_ENV === "production") return false;
  if (env.ONECOMPUTER_TEST_MODE !== "1") return false;
  if (env.ONECOMPUTER_TEST_INJECT_ALLOCATION_RESPONSE_FAILURE_ONCE !== "1")
    return false;
  if (injected) return false;
  injected = true;
  return true;
};

/** Test-only reset; production code never calls this. */
export const resetAllocationResponseFailureForTests = (): void => {
  injected = false;
};
