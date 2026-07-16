import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { KeyResolver, verifyIdToken } from "@openvtc/rp-sdk";
import { OPENVTC_RP_DID, OPENVTC_SESSION_SECRET } from "@/lib/env";
import type { AuthUser } from "./types";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const EXCHANGE_TTL_MS = 60 * 1000;
const SESSION_TTL_MS = 15 * 60 * 1000;

export const OPENVTC_SESSION_COOKIE = "onecomputer.openvtc.session";

type Challenge = { nonce: string; expiresAt: number };
type Exchange = { subject: string; expiresAt: number };
type Session = { subject: string; expiresAt: number };

// This adapter is intentionally process-local for its first vertical slice.
// Deployments with more than one web process must move these single-use records
// to Redis before enabling AUTH_MODE=openvtc in production.
const challenges = new Map<string, Challenge>();
const exchanges = new Map<string, Exchange>();

const b64url = (value: Buffer | string) =>
  Buffer.from(value).toString("base64url");

const requireConfig = () => {
  if (!OPENVTC_RP_DID || !OPENVTC_SESSION_SECRET) {
    throw new Error(
      "OpenVTC auth requires OPENVTC_RP_DID and OPENVTC_SESSION_SECRET",
    );
  }
};

const mac = (value: string) =>
  createHmac("sha256", OPENVTC_SESSION_SECRET)
    .update(value)
    .digest("base64url");

const cleanup = () => {
  const now = Date.now();
  for (const [id, record] of challenges)
    if (record.expiresAt <= now) challenges.delete(id);
  for (const [code, record] of exchanges)
    if (record.expiresAt <= now) exchanges.delete(code);
};

const opaqueEmailForDid = (did: string) =>
  `${createHash("sha256").update(did).digest("hex").slice(0, 32)}@openvtc.identity`;

export const userForOpenVtcDid = (did: string): AuthUser => ({
  id: `openvtc:${did}`,
  // ONEComputer's current User schema requires a unique email. This is a
  // non-routable stable identifier, not an asserted contact address. The
  // credential-to-profile mapping work will replace it with verified claims.
  email: opaqueEmailForDid(did),
  name: "OpenVTC identity",
});

export const issueOpenVtcChallenge = () => {
  requireConfig();
  cleanup();
  const sessionId = randomBytes(24).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(sessionId, { nonce, expiresAt });
  return {
    sessionId,
    challenge: nonce,
    expiresAt: new Date(expiresAt).toISOString(),
  };
};

export const verifyOpenVtcLogin = async (input: {
  sessionId: string;
  idToken: string;
}) => {
  requireConfig();
  cleanup();
  const challenge = challenges.get(input.sessionId);
  challenges.delete(input.sessionId); // nonce is single-use, including on failure
  if (!challenge || challenge.expiresAt <= Date.now()) {
    throw new Error("OpenVTC login challenge is missing or expired");
  }

  const verified = await verifyIdToken({
    idToken: input.idToken,
    audience: OPENVTC_RP_DID,
    nonce: challenge.nonce,
    resolver: new KeyResolver(),
  });
  const exchangeCode = randomBytes(32).toString("base64url");
  exchanges.set(exchangeCode, {
    subject: verified.subject,
    expiresAt: Date.now() + EXCHANGE_TTL_MS,
  });
  return { exchangeCode, subject: verified.subject };
};

export const consumeOpenVtcExchange = (code: string): Session => {
  requireConfig();
  cleanup();
  const exchange = exchanges.get(code);
  exchanges.delete(code); // one-time code: never permit replay
  if (!exchange || exchange.expiresAt <= Date.now()) {
    throw new Error("OpenVTC session exchange is missing or expired");
  }
  return { subject: exchange.subject, expiresAt: Date.now() + SESSION_TTL_MS };
};

export const serializeOpenVtcSession = (session: Session): string => {
  requireConfig();
  const payload = b64url(JSON.stringify(session));
  return `${payload}.${mac(payload)}`;
};

export const parseOpenVtcSession = (
  raw: string | undefined,
): Session | null => {
  if (!raw || !OPENVTC_SESSION_SECRET) return null;
  const [payload, signature, ...rest] = raw.split(".");
  if (!payload || !signature || rest.length) return null;
  const expected = mac(payload);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Session;
    if (typeof parsed.subject !== "string" || parsed.expiresAt <= Date.now())
      return null;
    return parsed;
  } catch {
    return null;
  }
};
