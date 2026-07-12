import type { AppDefinition } from "./types";

export const telegram: AppDefinition = {
  id: "telegram",
  name: "Telegram",
  icon: "/icons/telegram.svg",
  description: "Send and govern Telegram bot messages for agents.",
  connectionMethod: {
    type: "api_key",
    fields: [
      {
        name: "botToken",
        label: "Bot token",
        description:
          "Telegram Bot API token. Use OneCLI policies to restrict which agents can send messages or files.",
        placeholder: "123456789:AA...",
      },
    ],
    resolveMetadata: async (fields) => {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${fields.botToken}/getMe`,
        );
        if (res.ok) {
          const body = (await res.json()) as {
            ok?: boolean;
            result?: {
              id?: number;
              username?: string;
              first_name?: string;
            };
          };

          if (body.ok && body.result?.username) {
            return {
              name: `@${body.result.username}`,
              username: body.result.username,
              botId: body.result.id,
              displayName: body.result.first_name,
            };
          }
        }
      } catch {
        // Metadata is best-effort only. Invalid tokens are handled by callers.
      }

      return null;
    },
  },
  labelHint: 'e.g. "agent-notifications", "secops-approvals"',
  available: true,
};
