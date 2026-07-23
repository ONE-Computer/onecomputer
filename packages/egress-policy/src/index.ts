import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import {
  egressDecisionSchema,
  egressSecurityGroupVersionSchema,
  type EgressDecision,
  type EgressProtocol,
  type EgressSecurityGroupVersion,
} from "@onecomputer/contracts";

export type CompiledEgressRule = {
  id: string;
  action: "allow";
  protocol: EgressProtocol;
  host: string;
  includeSubdomains: boolean;
  port: number;
  purpose: string;
};

export type CompiledEgressSecurityGroup = {
  id: string;
  securityGroupId: string;
  tenantId: string;
  version: number;
  name: string;
  defaultAction: "deny";
  documentHash: string;
  rules: CompiledEgressRule[];
};

export type EgressConnection = {
  protocol: EgressProtocol;
  host: string;
  port: number;
  resolvedAddresses: string[];
};

export type EgressProxyGrantClaims = {
  aud: "onecomputer-egress-proxy";
  tenantId: string;
  subjectId: string;
  workspaceId: string;
  agentId: string;
  securityGroupVersionId: string;
  policyHash: string;
  iat: number;
  exp: number;
  jti: string;
};

const encode = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const sign = (value: string, secret: string) => encode(createHmac("sha256", secret).update(value).digest());

export function deriveEgressProxySecret(rootSecret: string, workspaceId: string) {
  if (rootSecret.length < 32) throw new Error("Egress proxy root secret must be at least 32 characters");
  return createHmac("sha256", rootSecret).update(`onecomputer-egress-proxy\0${workspaceId}`).digest("base64url");
}

export function issueEgressProxyGrant(
  secret: string,
  claims: Omit<EgressProxyGrantClaims, "aud" | "iat" | "exp" | "jti">,
  now = new Date(),
  ttlSeconds = 86_400,
) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: EgressProxyGrantClaims = {
    aud: "onecomputer-egress-proxy",
    ...claims,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: randomUUID(),
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyEgressProxyGrant(
  token: string,
  secret: string,
  expected: Pick<EgressProxyGrantClaims, "tenantId" | "subjectId" | "workspaceId" | "agentId" | "securityGroupVersionId" | "policyHash">,
  now = new Date(),
) {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(sign(encoded, secret));
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  let claims: EgressProxyGrantClaims;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as EgressProxyGrantClaims;
  } catch {
    return null;
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    claims.aud !== "onecomputer-egress-proxy"
    || !Number.isInteger(claims.iat)
    || !Number.isInteger(claims.exp)
    || claims.iat > nowSeconds + 30
    || claims.exp <= nowSeconds
    || !claims.jti
    || Object.entries(expected).some(([key, value]) => claims[key as keyof EgressProxyGrantClaims] !== value)
  ) return null;
  return claims;
}

export class EgressHostError extends Error {
  constructor(
    message: string,
    readonly reasonCode: "EGRESS_INVALID_HOST" | "EGRESS_IP_LITERAL_DENIED",
  ) {
    super(message);
    this.name = "EgressHostError";
  }
}

export function normalizeEgressHost(input: string) {
  if (!input || input !== input.trim()) {
    throw new EgressHostError("Egress host must not contain surrounding whitespace", "EGRESS_INVALID_HOST");
  }
  if (input.includes("*")) {
    throw new EgressHostError("Wildcard egress hosts are not allowed", "EGRESS_INVALID_HOST");
  }
  const unbracketed = input.startsWith("[") && input.endsWith("]") ? input.slice(1, -1) : input;
  if (isIP(unbracketed)) {
    throw new EgressHostError("IP literal egress destinations are not allowed", "EGRESS_IP_LITERAL_DENIED");
  }
  if (input.endsWith("..")) {
    throw new EgressHostError("Egress host has an invalid trailing label", "EGRESS_INVALID_HOST");
  }
  const withoutRootDot = input.endsWith(".") ? input.slice(0, -1) : input;
  const normalized = domainToASCII(withoutRootDot).toLowerCase();
  if (!normalized || normalized.length > 253 || !normalized.includes(".")) {
    throw new EgressHostError("Egress host must be a fully qualified domain name", "EGRESS_INVALID_HOST");
  }
  const labels = normalized.split(".");
  if (labels.some((label) => (
    !label
    || label.length > 63
    || !/^[a-z0-9-]+$/.test(label)
    || label.startsWith("-")
    || label.endsWith("-")
  ))) {
    throw new EgressHostError("Egress host contains an invalid label", "EGRESS_INVALID_HOST");
  }
  return normalized;
}

export function compileEgressSecurityGroup(input: EgressSecurityGroupVersion): CompiledEgressSecurityGroup {
  const group = egressSecurityGroupVersionSchema.parse(input);
  const rules = group.rules.map((rule) => ({
    ...rule,
    host: normalizeEgressHost(rule.host),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const identities = new Set<string>();
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate egress rule id: ${rule.id}`);
    ids.add(rule.id);
    const identity = `${rule.protocol}\0${rule.host}\0${rule.includeSubdomains}\0${rule.port}`;
    if (identities.has(identity)) throw new Error(`Duplicate egress rule destination: ${rule.id}`);
    identities.add(identity);
  }
  return {
    id: group.id,
    securityGroupId: group.securityGroupId,
    tenantId: group.tenantId,
    version: group.version,
    name: group.name,
    defaultAction: group.defaultAction,
    documentHash: group.documentHash,
    rules,
  };
}

const isReservedIpv4 = (address: string) => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
};

export function isReservedAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isReservedIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isReservedIpv4(mapped[1]!);
  return (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("2001:db8:")
  );
}

const deny = (reasonCode: EgressDecision["reasonCode"]) => egressDecisionSchema.parse({
  decision: "deny",
  reasonCode,
});

export function decideEgress(
  policy: CompiledEgressSecurityGroup,
  connection: EgressConnection,
): EgressDecision {
  let host: string;
  try {
    host = normalizeEgressHost(connection.host);
  } catch (error) {
    if (error instanceof EgressHostError) return deny(error.reasonCode);
    return deny("EGRESS_INVALID_HOST");
  }
  if (!connection.resolvedAddresses.length) return deny("EGRESS_DNS_UNAVAILABLE");
  if (connection.resolvedAddresses.some(isReservedAddress)) return deny("EGRESS_DESTINATION_RESERVED");
  const rule = policy.rules.find((candidate) => (
    candidate.protocol === connection.protocol
    && candidate.port === connection.port
    && (
      host === candidate.host
      || (candidate.includeSubdomains && host.endsWith(`.${candidate.host}`))
    )
  ));
  return rule
    ? egressDecisionSchema.parse({ decision: "allow", reasonCode: "EGRESS_ALLOWED", ruleId: rule.id })
    : deny("EGRESS_DEFAULT_DENY");
}
