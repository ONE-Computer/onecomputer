"use server";

import "@/lib/init/server";
import { resolveProjectContext } from "@/lib/actions/resolve-user";
import {
  getLlmTraces,
  type LlmTraceEntry,
} from "@onecli/api/services/request-log-service";

// Read-only server action backing the LLM Traces admin page. Resolves the
// caller's project context and delegates to getLlmTraces, which reads the
// LLM-call subset of the gateway's request_logs telemetry. No mutation.

export const getLlmTracesPage = async (
  limit = 100,
): Promise<LlmTraceEntry[]> => {
  const { projectId } = await resolveProjectContext();
  return getLlmTraces(projectId, limit);
};
