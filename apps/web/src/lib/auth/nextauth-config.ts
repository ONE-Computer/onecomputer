import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import {
  AZURE_AD_CLIENT_ID,
  AZURE_AD_CLIENT_SECRET,
  AZURE_AD_TENANT_ID,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  NEXTAUTH_SECRET,
} from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

const providers = [];

if (GOOGLE_CLIENT_ID) {
  providers.push(
    Google({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
    }),
  );
}

if (AZURE_AD_CLIENT_ID && AZURE_AD_CLIENT_SECRET && AZURE_AD_TENANT_ID) {
  providers.push(
    MicrosoftEntraID({
      clientId: AZURE_AD_CLIENT_ID,
      clientSecret: AZURE_AD_CLIENT_SECRET,
      // Restrict sign-in to a single tenant by setting the issuer to the
      // tenant-specific v2.0 endpoint. Without this it defaults to "common"
      // (any Microsoft account). The AZURE_AD_TENANT_ID env var is the
      // Directory (tenant) ID from the app registration.
      issuer: `https://login.microsoftonline.com/${AZURE_AD_TENANT_ID}/v2.0`,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username,
          email: profile.email ?? profile.preferred_username,
          image: null,
        };
      },
    }),
  );
}

export const { auth, handlers } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  secret: NEXTAUTH_SECRET,
  // NextAuth v5 mounts its handlers (apps/web/src/app/v1/auth/[...nextauth])
  // under `/v1/auth`, not the default `/api/auth`. Without `basePath` the
  // server-side action parser strips `/api/auth` from the request path, fails
  // to find the action, and returns `UnknownAction` (HTTP 400) for every
  // client call — csrf/session/signin/callback alike. Setting `basePath`
  // here makes the server parse actions correctly AND must be mirrored on the
  // client via `<SessionProvider basePath="/v1/auth">` (see auth-provider.tsx).
  basePath: "/v1/auth",
  // Trust the Host header outside Vercel/CF (dev defaults to true; this makes
  // production self-hosted deploys work without AUTH_URL).
  trustHost: true,
  // Explicit cookie config: when accessing via the SSH tunnel (127.0.0.1:10254)
  // vs the canonical NEXTAUTH_URL (localhost:10254), the PKCE code_verifier cookie
  // must be readable on both hosts. Force sameSite=lax + no domain restriction
  // (the browser uses the request host). This fixes the InvalidCheck error.
  cookies: {
    pkceCodeVerifier: {
      name: "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
    csrfToken: {
      name: "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
    sessionToken: {
      name: "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
      },
    },
  },
  pages: {
    signIn: "/auth/login",
  },
  callbacks: {
    jwt({ token, account }) {
      if (account) {
        token.authId = account.providerAccountId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.authId as string;
      }
      return session;
    },
  },
});
