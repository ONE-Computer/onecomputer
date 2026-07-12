"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { invgini } from "@/lib/api";
import { queryKeys } from "@/lib/api/keys";

export const useInvginiAgents = () =>
  useQuery({
    queryKey: queryKeys.invgini.agents(),
    queryFn: invgini.listInvginiAgents,
  });

export const useInvginiEvidencePack = (principalId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.invgini.evidencePack(principalId ?? "none"),
    queryFn: () => invgini.getInvginiAgentEvidencePack(principalId!),
    enabled: Boolean(principalId),
  });

export const useInvginiEventLogs = (principalId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.invgini.eventLogs(principalId ?? "none"),
    queryFn: () => invgini.getInvginiAgentEventLogs(principalId!),
    enabled: Boolean(principalId),
  });

export const useCreateInvginiControlAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: invgini.createInvginiControlAction,
    onSuccess: (control) => {
      qc.invalidateQueries({ queryKey: queryKeys.invgini.all() });
      toast.success(
        control.action === "EXPORT_RECEIPTS"
          ? "Receipt export intent recorded"
          : "SecOps control recorded",
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to record SecOps control",
      ),
  });
};

export const useResolveInvginiControlAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: invgini.resolveInvginiControlAction,
    onSuccess: (control) => {
      qc.invalidateQueries({ queryKey: queryKeys.invgini.all() });
      toast.success(`SecOps control marked ${control.status.toLowerCase()}`);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update SecOps control",
      ),
  });
};
