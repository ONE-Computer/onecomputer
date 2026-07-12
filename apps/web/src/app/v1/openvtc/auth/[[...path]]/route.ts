import { NextResponse } from "next/server";
import {
  issueOpenVtcChallenge,
  verifyOpenVtcLogin,
} from "@/lib/auth/openvtc-session";

export const dynamic = "force-dynamic";

const AUTHENTICATE_TYPE = "https://trusttasks.org/spec/auth/authenticate/0.1";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path = [] } = await params;
  if (path.length === 1 && path[0] === "challenge") {
    try {
      // The DID supplied by the wallet is not trusted here. The following
      // authenticated envelope establishes the subject from its signed token.
      await request.json().catch(() => ({}));
      return NextResponse.json(issueOpenVtcChallenge());
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "OpenVTC is unavailable",
        },
        { status: 503 },
      );
    }
  }

  if (path.length === 0) {
    try {
      const body = (await request.json()) as {
        type?: string;
        payload?: { id_token?: string; session_id?: string };
      };
      if (
        body.type !== AUTHENTICATE_TYPE ||
        !body.payload?.id_token ||
        !body.payload.session_id
      ) {
        return NextResponse.json(
          { error: "Invalid OpenVTC authentication envelope" },
          { status: 400 },
        );
      }
      const { exchangeCode, subject } = await verifyOpenVtcLogin({
        sessionId: body.payload.session_id,
        idToken: body.payload.id_token,
      });
      return NextResponse.json({
        session: {
          id: body.payload.session_id,
          subject,
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          amr: ["siopv2"],
          acr: "aal1",
        },
        tokens: {
          // This is deliberately an opaque, one-time exchange code—not a
          // bearer credential. The page exchanges it for an HttpOnly cookie.
          accessToken: exchangeCode,
          refreshToken: "",
          tokenType: "Bearer",
          expiresIn: 60,
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "OpenVTC login failed",
        },
        { status: 401 },
      );
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
