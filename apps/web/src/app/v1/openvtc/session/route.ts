import { NextResponse } from "next/server";
import {
  consumeOpenVtcExchange,
  OPENVTC_SESSION_COOKIE,
  parseOpenVtcSession,
  serializeOpenVtcSession,
  userForOpenVtcDid,
} from "@/lib/auth/openvtc-session";

export const dynamic = "force-dynamic";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export async function GET(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${OPENVTC_SESSION_COOKIE}=`))
    ?.slice(OPENVTC_SESSION_COOKIE.length + 1);
  const session = parseOpenVtcSession(raw);
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ user: userForOpenVtcDid(session.subject) });
}

export async function POST(request: Request) {
  try {
    const { exchangeCode } = (await request.json()) as {
      exchangeCode?: string;
    };
    if (!exchangeCode)
      return NextResponse.json(
        { error: "exchangeCode is required" },
        { status: 400 },
      );
    const session = consumeOpenVtcExchange(exchangeCode);
    const response = NextResponse.json({
      user: userForOpenVtcDid(session.subject),
    });
    response.cookies.set(
      OPENVTC_SESSION_COOKIE,
      serializeOpenVtcSession(session),
      {
        ...cookieOptions,
        expires: new Date(session.expiresAt),
      },
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "OpenVTC session exchange failed",
      },
      { status: 401 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(OPENVTC_SESSION_COOKIE, "", {
    ...cookieOptions,
    maxAge: 0,
  });
  return response;
}
