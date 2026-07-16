import type { AppDefinition, OAuthExchangeResult } from "./types";

/**
 * Microsoft Graph connector used by the governed Outlook path.
 *
 * The access token is encrypted as an AppConnection credential and injected
 * by the Rust gateway only for graph.microsoft.com requests. It is never
 * returned by the API or copied into the sandbox runtime.
 */
const exchangeCredentials = async (
  fields: Record<string, string>,
): Promise<OAuthExchangeResult> => {
  const accessToken = fields.accessToken?.trim();
  if (!accessToken) {
    throw new Error("Microsoft Graph access token is required");
  }

  return {
    credentials: {
      access_token: accessToken,
    },
    scopes: ["Mail.Send"],
    metadata: {
      name: "Microsoft Graph Outlook",
      host: "graph.microsoft.com",
    },
  };
};

export const microsoftGraph: AppDefinition = {
  id: "microsoft-graph",
  name: "Microsoft Graph (Outlook)",
  icon: "/icons/outlook-mail.svg",
  description:
    "Send governed Outlook mail through Microsoft Graph with gateway-managed credential injection.",
  connectionMethod: {
    type: "credentials_import",
    fields: [
      {
        name: "accessToken",
        label: "Microsoft Graph access token",
        description:
          "Stored encrypted by ONEComputer and injected only for Microsoft Graph requests.",
        placeholder: "eyJ...",
        secret: true,
      },
    ],
    exchangeCredentials,
  },
  labelHint: 'e.g. "company Outlook"',
  available: true,
};
