"use server";

import { resolveProjectContext } from "@/lib/actions/resolve-user";
import {
  getRecentRequestLogs,
  getRequestLogs,
  getBlockedRequestCount24h,
  type ActivityPageParams,
} from "@onecli/api/services/request-log-service";

export const getRecentActivity = async () => {
  const { projectId } = await resolveProjectContext();
  return getRecentRequestLogs(projectId, 5);
};

export const getActivityPage = async (params: ActivityPageParams = {}) => {
  const { projectId } = await resolveProjectContext();
  return getRequestLogs(projectId, params);
};

// Count of gateway-blocked requests in the last 24h, for the CISO command
// center. Resolves to 0 when there are no logs rather than throwing.
export const getBlockedActivityCount24h = async (): Promise<number> => {
  const { projectId } = await resolveProjectContext();
  return getBlockedRequestCount24h(projectId);
};
