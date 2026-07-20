import { createHash, randomBytes } from "node:crypto";
import { OneComputerError, type IdentityContext } from "@onecomputer/contracts";
import type { OAuthConnectionGateway, OAuthConnectionStatus } from "@onecomputer/litellm-adapter";

const microsoft365Server = "onecomputer_ms365";

type PendingConnection = {
  tenantId: string;
  subjectId: string;
  codeVerifier: string;
  expiresAt: number;
};

type ConnectionServiceOptions = {
  publicWebUrl: string;
  authorizationOrigin: string;
  sessionTtlMs?: number;
  now?: () => number;
};

const stateDigest = (state: string) => createHash("sha256").update(state).digest("base64url");

export class Microsoft365ConnectionService {
  private readonly sessions = new Map<string, PendingConnection>();
  private readonly publicWebUrl: string;
  private readonly callbackUrl: string;
  private readonly authorizationOrigin: string;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly gateway: OAuthConnectionGateway, options: ConnectionServiceOptions) {
    const publicWebUrl = new URL(options.publicWebUrl);
    if (!['http:', 'https:'].includes(publicWebUrl.protocol)) throw new Error("PUBLIC_WEB_URL must use http or https");
    this.publicWebUrl = publicWebUrl.toString().replace(/\/$/, "");
    this.callbackUrl = `${this.publicWebUrl}/api/v1/connections/microsoft-365/callback`;
    this.authorizationOrigin = new URL(options.authorizationOrigin).origin;
    this.sessionTtlMs = options.sessionTtlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  async start(identity: IdentityContext) {
    this.pruneExpired();
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const key = stateDigest(state);
    this.sessions.set(key, {
      tenantId: identity.tenantId,
      subjectId: identity.subjectId,
      codeVerifier,
      expiresAt: this.now() + this.sessionTtlMs,
    });
    try {
      const started = await this.gateway.beginUserOAuthConnection({
        identity,
        serverName: microsoft365Server,
        redirectUri: this.callbackUrl,
        state,
        codeChallenge,
        authorizationOrigin: this.authorizationOrigin,
      });
      return started;
    } catch (error) {
      this.sessions.delete(key);
      throw error;
    }
  }

  async complete(identity: IdentityContext, input: { state?: string; code?: string; error?: string }): Promise<OAuthConnectionStatus> {
    this.pruneExpired();
    if (!input.state) throw new OneComputerError("M365_OAUTH_STATE_MISSING", "The Microsoft 365 connection could not be verified", 400);
    const key = stateDigest(input.state);
    const pending = this.sessions.get(key);
    this.sessions.delete(key);
    if (!pending) throw new OneComputerError("M365_OAUTH_STATE_INVALID", "The Microsoft 365 connection expired or was already used", 400);
    if (pending.expiresAt <= this.now()) throw new OneComputerError("M365_OAUTH_STATE_EXPIRED", "The Microsoft 365 connection expired; please try again", 400);
    if (pending.tenantId !== identity.tenantId || pending.subjectId !== identity.subjectId) {
      throw new OneComputerError("M365_OAUTH_IDENTITY_MISMATCH", "The Microsoft 365 connection belongs to another user", 403);
    }
    if (input.error) throw new OneComputerError("M365_OAUTH_DENIED", "Microsoft 365 access was not granted", 400);
    if (!input.code || input.code.length > 4096) throw new OneComputerError("M365_OAUTH_CODE_INVALID", "Microsoft 365 returned an invalid authorization response", 400);
    return this.gateway.completeUserOAuthConnection({
      identity,
      serverName: microsoft365Server,
      code: input.code,
      codeVerifier: pending.codeVerifier,
    });
  }

  status(identity: IdentityContext) {
    return this.gateway.userOAuthConnectionStatus(identity, microsoft365Server);
  }

  disconnect(identity: IdentityContext) {
    return this.gateway.disconnectUserOAuthConnection(identity, microsoft365Server);
  }

  resultUrl(result: "connected" | "error", reason?: string) {
    const url = new URL(this.publicWebUrl);
    url.searchParams.set("view", "connections");
    url.searchParams.set("m365", result);
    if (reason) url.searchParams.set("reason", reason);
    return url.toString();
  }

  private pruneExpired() {
    const now = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}
