// Lifted verbatim from scripts/onecomputer/e2e-gateway-approval-proof.mjs

export async function pollUntil(fn, predicate, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn().catch(() => null);
    if (result && predicate(result)) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}
