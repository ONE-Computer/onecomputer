"use client";

import { useQuery } from "@tanstack/react-query";
import { sandboxesApi } from "@/lib/api/sandboxes";
import { queryKeys } from "@/lib/api/keys";

export const useSandboxCounts = () =>
  useQuery({
    queryKey: queryKeys.sandboxes.counts(),
    queryFn: sandboxesApi.counts,
  });
