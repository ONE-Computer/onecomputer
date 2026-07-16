"use client";

import { useQuery } from "@tanstack/react-query";
import { getBlockedActivityCount24h } from "@/lib/actions/request-logs";
import { queryKeys } from "@/lib/api/keys";

// Count of gateway-blocked requests in the last 24h (server action).
export const useBlockedActivity24h = () =>
  useQuery({
    queryKey: queryKeys.activity.blocked24h(),
    queryFn: getBlockedActivityCount24h,
    retry: false,
  });
