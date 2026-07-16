"use client";

import { useQuery } from "@tanstack/react-query";
import { summary as fetchApprovalSummary } from "@/lib/api/approvals";
import { queryKeys } from "@/lib/api/keys";

// GET /v1/approvals/summary — { pending, approved24h, denied24h }.
export const useApprovalsSummary = () =>
  useQuery({
    queryKey: queryKeys.approvals.summary(),
    queryFn: fetchApprovalSummary,
    retry: false,
  });
