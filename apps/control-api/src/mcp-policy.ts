import { createHash, randomUUID } from "node:crypto";
import {
  OneComputerError,
  canonicalJson,
  type IdentityContext,
  type McpPolicyDecision,
  type McpPolicyRequest,
  type OwnedJson,
} from "@onecomputer/contracts";
import { runtimePolicyFor, type GovernanceStore, type IdentityPolicyStore, type WorkspaceStore } from "@onecomputer/workspace-store";
import { z } from "zod";
import type { GovernedOperationService } from "./operations.js";

const boundedListArguments = z.strictObject({
  top: z.number().int().min(1).max(25).optional(),
});

const boundedDriveSearchArguments = z.strictObject({
  driveId: z.string().trim().min(1).max(512),
  q: z.string().trim().min(1).max(128),
  select: z.literal("id,name,eTag,parentReference").optional(),
  top: z.number().int().min(1).max(10).optional(),
});

const driveItemMetadataArguments = z.strictObject({
  driveId: z.string().trim().min(1).max(512),
  driveItemId: z.string().trim().min(1).max(512),
  includeHeaders: z.literal(true),
  select: z.literal("id,name,eTag,parentReference"),
});

const deleteRequestArguments = z.strictObject({
  driveId: z.string().trim().min(1).max(512),
  driveItemId: z.string().trim().min(1).max(512),
  "If-Match": z.string().trim().min(1).max(512),
  confirm: z.literal(false).optional(),
});

type CapabilityDefinition = {
  capabilityId: string;
  schemaId: string;
  schemaHash: string;
  mode: "allow" | "approval_required";
  parse: (argumentsValue: OwnedJson) => Record<string, OwnedJson>;
};

const definition = (
  capabilityId: string,
  schemaId: string,
  mode: CapabilityDefinition["mode"],
  schema: z.ZodType<Record<string, OwnedJson>>,
): CapabilityDefinition => ({
  capabilityId,
  schemaId,
  schemaHash: createHash("sha256").update(canonicalJson({ schemaId, jsonSchema: z.toJSONSchema(schema) })).digest("hex"),
  mode,
  parse: (value) => schema.parse(value),
});

export const m365CapabilityDefinitions = {
  "list-mail-folders": definition("m365.mail-folders.list", "onecomputer.m365.list-mail-folders.v1", "allow", boundedListArguments),
  "list-calendars": definition("m365.calendars.list", "onecomputer.m365.list-calendars.v1", "allow", boundedListArguments),
  "list-drives": definition("m365.drives.list", "onecomputer.m365.list-drives.v1", "allow", boundedListArguments),
  "search-onedrive-files": definition("m365.files.search", "onecomputer.m365.search-onedrive-files.v1", "allow", boundedDriveSearchArguments),
  "get-drive-item": definition("m365.files.metadata.get", "onecomputer.m365.get-drive-item.v1", "allow", driveItemMetadataArguments),
  "delete-onedrive-file": definition("onedrive-delete-protected", "onecomputer.m365.delete-onedrive-file.v1", "approval_required", deleteRequestArguments),
} as const satisfies Record<string, CapabilityDefinition>;

export const m365LiteLlmServerId = createHash("sha256")
  .update("onecomputer_ms365|http://ms365-mcp:3000/mcp|http|oauth2|")
  .digest("hex")
  .slice(0, 32);

const denied = (code: string, capability?: CapabilityDefinition): McpPolicyDecision => ({
  schemaVersion: 1,
  decision: "deny",
  code,
  capabilityId: capability?.capabilityId ?? null,
  schemaId: capability?.schemaId ?? null,
  schemaHash: capability?.schemaHash ?? null,
  operationId: null,
});

export class McpPolicyService {
  constructor(
    private readonly identityPolicies: IdentityPolicyStore,
    private readonly governance: WorkspaceStore & GovernanceStore,
    private readonly operations: GovernedOperationService,
  ) {}

  async authorize(request: McpPolicyRequest, correlationId: string): Promise<McpPolicyDecision> {
    const capability = m365CapabilityDefinitions[request.toolName as keyof typeof m365CapabilityDefinitions];
    if (request.serverId !== m365LiteLlmServerId || request.serverName !== "onecomputer_ms365" || !capability) return denied("MCP_TOOL_NOT_GOVERNED");

    const identity: IdentityContext = {
      tenantId: request.tenantId,
      subjectId: request.subjectId,
      audience: "onecomputer-control",
    };
    const [principal, effectivePolicy, workspace] = await Promise.all([
      this.identityPolicies.getPrincipal(request.subjectId),
      this.identityPolicies.getEffectivePolicy(request.subjectId),
      this.governance.getOwned(identity, request.workspaceId),
    ]);
    if (!principal || principal.tenantId !== request.tenantId) return denied("MCP_IDENTITY_MISMATCH", capability);
    if (!effectivePolicy || !workspace) return denied("MCP_POLICY_NOT_ASSIGNED", capability);

    const runtime = runtimePolicyFor(effectivePolicy);
    const bindingMatches = runtime.agentId === request.agentId
      && runtime.policyVersionId === request.policyVersionId
      && runtime.policyHash === request.policyHash
      && effectivePolicy.workspaceId === request.workspaceId
      && runtime.mcpServer === request.serverName
      && runtime.allowedTools.includes(request.toolName);
    const isExecution = Boolean(request.operationId || request.operationDigest || request.leaseId);
    if (!bindingMatches && !isExecution) return denied("MCP_POLICY_BINDING_MISMATCH", capability);

    if (isExecution) {
      if (!request.operationId || !request.operationDigest || !request.leaseId) return denied("MCP_EXECUTION_BINDING_INCOMPLETE", capability);
      const claimed = await this.governance.claimToolDispatch(identity, {
        operationId: request.operationId,
        operationDigest: request.operationDigest,
        leaseId: request.leaseId,
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        serverName: request.serverName,
        toolName: request.toolName,
        arguments: request.arguments,
        dispatchedAt: new Date(),
        correlationId,
      });
      return claimed ? {
        schemaVersion: 1,
        decision: "allow",
        code: "MCP_APPROVED_EXECUTION_LEASE",
        capabilityId: capability.capabilityId,
        schemaId: capability.schemaId,
        schemaHash: capability.schemaHash,
        operationId: request.operationId,
      } : denied("MCP_EXECUTION_BINDING_INVALID", capability);
    }

    let canonicalArguments: Record<string, OwnedJson>;
    try {
      canonicalArguments = capability.parse(request.arguments);
    } catch {
      return denied("MCP_ARGUMENTS_OUT_OF_POLICY", capability);
    }

    if (capability.mode === "allow") return {
      schemaVersion: 1,
      decision: "allow",
      code: "MCP_BOUNDED_READ_ALLOWED",
      capabilityId: capability.capabilityId,
      schemaId: capability.schemaId,
      schemaHash: capability.schemaHash,
      operationId: null,
    };

    const operation = await this.operations.createMicrosoft365Delete(
      identity,
      request.workspaceId,
      canonicalArguments as { driveId: string; driveItemId: string; "If-Match": string },
      runtime.agentId,
      { policyVersionId: runtime.policyVersionId, policyHash: runtime.policyHash },
      createHash("sha256").update(canonicalJson({
        tenantId: request.tenantId,
        subjectId: request.subjectId,
        workspaceId: request.workspaceId,
        agentId: request.agentId,
        policyVersionId: request.policyVersionId,
        toolName: request.toolName,
        arguments: canonicalArguments,
      })).digest("hex"),
      correlationId || randomUUID(),
    );
    return {
      schemaVersion: 1,
      decision: "approval_required",
      code: "MCP_APPROVAL_REQUIRED",
      capabilityId: capability.capabilityId,
      schemaId: capability.schemaId,
      schemaHash: capability.schemaHash,
      operationId: operation.id,
    };
  }
}

export const requireMcpPolicyAllow = (decision: McpPolicyDecision) => {
  if (decision.decision !== "allow") throw new OneComputerError(decision.code, "The Microsoft 365 tool call is not approved for execution", 403);
  return decision;
};
