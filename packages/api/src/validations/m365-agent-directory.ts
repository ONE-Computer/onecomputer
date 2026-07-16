import { z } from "zod";

export const mailAuthResultSchema = z.object({
  spf: z.enum(["pass", "fail", "neutral", "none"]),
  dkim: z.enum(["pass", "fail", "none"]),
  dmarc: z.enum(["pass", "fail", "none"]),
  arc: z.enum(["pass", "fail", "none"]),
});

export const mailroomNormalizePreviewSchema = z.object({
  messageId: z.string().min(1),
  receivedAt: z.string().datetime(),
  rawMime: z.string().min(1).max(128_000),
  fromAddress: z.string().email(),
  subject: z.string().min(1).max(512),
  bodyText: z.string().min(1).max(32_000),
  attachmentNames: z.array(z.string().min(1).max(255)).max(20).default([]),
  auth: mailAuthResultSchema,
});
