"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  SessionProvider,
  useSession,
  signIn as nextAuthSignIn,
  signOut as nextAuthSignOut,
} from "next-auth/react";
import { AuthContext } from "@/providers/auth-provider";
import type { AuthUser, AuthContextValue } from "@/lib/auth/types";
import type { AuthMode } from "@/lib/auth/auth-mode";

const LOCAL_USER: AuthUser = {
  id: "local-admin",
  email: "admin@localhost",
  name: "Admin",
};

const LocalAuthProvider = ({ children }: { children: ReactNode }) => {
  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: true,
      isLoading: false,
      user: LOCAL_USER,
      signIn: async () => {},
      signOut: async () => {},
    }),
    [],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

declare global {
  interface Window {
    vtaWallet?: {
      login(params: {
        rpDid: string;
        baseUrl: string;
      }): Promise<{ accessToken: string }>;
    };
  }
}

const OpenVtcAuthProvider = ({
  children,
  rpDid,
}: {
  children: ReactNode;
  rpDid: string;
}) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/v1/openvtc/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { user: AuthUser };
      })
      .then((result) => setUser(result?.user ?? null))
      .finally(() => setIsLoading(false));
  }, []);

  const signIn = useCallback(async () => {
    if (!rpDid) throw new Error("OpenVTC relying-party DID is not configured");
    if (!window.vtaWallet) {
      throw new Error("OpenVTC Wallet is required to sign in");
    }
    const login = await window.vtaWallet.login({
      rpDid,
      baseUrl: `${window.location.origin}/v1/openvtc`,
    });
    const response = await fetch("/v1/openvtc/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exchangeCode: login.accessToken }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "OpenVTC session exchange failed");
    }
    const body = (await response.json()) as { user: AuthUser };
    setUser(body.user);
  }, [rpDid]);

  const signOut = useCallback(async () => {
    await fetch("/v1/openvtc/session", { method: "DELETE" });
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: !!user,
      isLoading,
      user,
      signIn,
      signOut,
      authMethod: "openvtc",
    }),
    [isLoading, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

const OAuthInner = ({
  children,
  entraConfigured,
}: {
  children: ReactNode;
  entraConfigured: boolean;
}) => {
  const { data: session, status } = useSession();

  const user = useMemo<AuthUser | null>(() => {
    if (!session?.user?.id || !session.user.email) return null;
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
    };
  }, [session]);

  const signIn = useCallback(async () => {
    await nextAuthSignIn("google");
  }, []);

  const signInMicrosoft = useCallback(async () => {
    await nextAuthSignIn("microsoft-entra-id");
  }, []);

  const signOut = useCallback(async () => {
    await nextAuthSignOut({ callbackUrl: "/auth/login" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: status === "authenticated",
      isLoading: status === "loading",
      user,
      signIn,
      signOut,
      ...(entraConfigured ? { signInMicrosoft } : {}),
    }),
    [status, user, signIn, signOut, entraConfigured, signInMicrosoft],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const AuthProviderImpl = ({
  children,
  authMode,
  entraConfigured = false,
  openVtcRpDid = "",
}: {
  children: ReactNode;
  authMode: AuthMode;
  entraConfigured?: boolean;
  openVtcRpDid?: string;
}) => {
  if (authMode === "local") {
    return <LocalAuthProvider>{children}</LocalAuthProvider>;
  }

  if (authMode === "openvtc") {
    return (
      <OpenVtcAuthProvider rpDid={openVtcRpDid}>{children}</OpenVtcAuthProvider>
    );
  }

  return (
    <SessionProvider basePath="/v1/auth">
      <OAuthInner entraConfigured={entraConfigured}>{children}</OAuthInner>
    </SessionProvider>
  );
};
