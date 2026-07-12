import { apiGet, apiPost, apiPatch, apiDelete } from "./client";

export type OrgRole = "owner" | "admin" | "manager" | "member";

export interface Member {
  userId: string;
  userEmail: string;
  role: OrgRole;
  createdAt: string;
}

export interface InviteMemberResult {
  invitationId: string;
  invitationUrl: string;
  token: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
}

export interface UpdateMemberRoleResult {
  userId: string;
  role: OrgRole;
}

export const list = () => apiGet<Member[]>("/v1/members");

export const invite = (email: string, role: OrgRole) =>
  apiPost<InviteMemberResult>("/v1/members/invite", { email, role });

export const updateRole = (userId: string, role: OrgRole) =>
  apiPatch<UpdateMemberRoleResult>(`/v1/members/${userId}/role`, { role });

export const remove = (userId: string) => apiDelete(`/v1/members/${userId}`);
