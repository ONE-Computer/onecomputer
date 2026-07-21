import { createHmac, timingSafeEqual } from "node:crypto";
import { OneComputerError, type IdentityContext, type RuntimePolicy } from "@onecomputer/contracts";
import { z } from "zod";

const payloadSchema = z.strictObject({
  version: z.literal(1),
  tenantId: z.string().min(1).max(128),
  subjectId: z.string().min(1).max(128),
  workspaceId: z.uuid(),
  agentId: z.string().min(1).max(128),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type AgentBridgeIdentity = z.infer<typeof payloadSchema>;

export class AgentBridgeAuthority {
  constructor(private readonly secret: string) {
    if (secret.length < 24) throw new Error("Agent bridge secret must be at least 24 characters");
  }

  issue(identity: IdentityContext, workspaceId: string, policy: RuntimePolicy) {
    const payload = payloadSchema.parse({
      version: 1,
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      workspaceId,
      agentId: policy.agentId,
      policyHash: policy.policyHash,
    });
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `ocab_${encoded}.${this.sign(encoded)}`;
  }

  verify(token: string): AgentBridgeIdentity {
    const match = /^ocab_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) throw new OneComputerError("UNAUTHENTICATED", "Agent bridge authentication is required", 401);
    const expected = Buffer.from(this.sign(match[1]!));
    const received = Buffer.from(match[2]!);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new OneComputerError("UNAUTHENTICATED", "Agent bridge authentication is invalid", 401);
    }
    try {
      return payloadSchema.parse(JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8")));
    } catch {
      throw new OneComputerError("UNAUTHENTICATED", "Agent bridge authentication is invalid", 401);
    }
  }

  private sign(payload: string) {
    return createHmac("sha256", this.secret).update(`onecomputer:agent-bridge:${payload}`).digest("base64url");
  }
}
