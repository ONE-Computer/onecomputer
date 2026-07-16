import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "manager", "member"]);

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  role: orgRoleSchema,
});

export const updateMemberRoleSchema = z.object({
  role: orgRoleSchema,
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
