import type { AppPermissionDefinition } from "./types";

export const telegramPermissions: AppPermissionDefinition = {
  provider: "telegram",
  groups: [
    {
      category: "read",
      tools: [
        {
          id: "get_me",
          name: "Get bot profile",
          description: "Read the Telegram bot profile connected to OneCLI",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/getMe",
          method: "GET",
        },
        {
          id: "get_updates",
          name: "Read bot updates",
          description:
            "Read incoming bot updates. Use sparingly because it can expose chat metadata.",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/getUpdates",
          method: "GET",
        },
        {
          id: "get_chat",
          name: "Read chat metadata",
          description: "Read metadata for a Telegram chat",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/getChat",
          method: "GET",
        },
      ],
    },
    {
      category: "write",
      tools: [
        {
          id: "send_message",
          name: "Send message",
          description: "Send a text message to a Telegram chat",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/sendMessage",
          method: "POST",
        },
        {
          id: "edit_message",
          name: "Edit message",
          description: "Edit a message previously sent by the bot",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/editMessageText",
          method: "POST",
        },
        {
          id: "delete_message",
          name: "Delete message",
          description:
            "Delete a Telegram message. Default policies should require manual approval.",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/deleteMessage",
          method: "POST",
        },
        {
          id: "send_document",
          name: "Send document",
          description:
            "Send a document to a Telegram chat. Default policies should block this for autonomous agents.",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/sendDocument",
          method: "POST",
        },
        {
          id: "send_photo",
          name: "Send photo",
          description:
            "Send an image to a Telegram chat. Default policies should require manual approval.",
          hostPattern: "api.telegram.org",
          pathPattern: "/bot*/sendPhoto",
          method: "POST",
        },
      ],
    },
  ],
};
