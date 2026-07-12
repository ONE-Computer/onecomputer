import { getServerSessionForRequest } from "@/lib/auth/server";
import type { SessionProvider } from "@onecli/api";

export const nextSessionProvider: SessionProvider = {
  // Pass the inbound request so the dev-only persona override (ONE-125) can
  // read `?persona=` / `X-OneComputer-Persona`. In non-local or production
  // mode the request is simply ignored by getServerSessionImpl.
  getSession: async (request) => {
    const session = await getServerSessionForRequest(request);
    if (!session) return null;
    return { id: session.id, email: session.email, name: session.name };
  },
};
