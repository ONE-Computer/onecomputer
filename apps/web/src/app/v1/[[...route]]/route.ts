import { handle } from "hono/vercel";
import type { NextRequest } from "next/server";
import {
  generateSamplePolicyApprovalPreview,
  generateSamplePolicyArtifactPreview,
  generateSamplePolicyDiffExport,
} from "@onecli/api/services/policy-artifact-service";
import { app } from "@/lib/api/app";
import {
  createInvginiControlRoute,
  ingestInvginiEventsRoute,
  listInvginiFleetRoute,
  listInvginiProjectRegistryRoute,
} from "@/lib/api/invgini-next-routes";

const handler = handle(app);

const samplePolicyArtifactPayload = () => ({
  preview: generateSamplePolicyArtifactPreview(),
  approvalWorkflow: generateSamplePolicyApprovalPreview(),
  diffExport: generateSamplePolicyDiffExport(),
  apiSemantics: {
    deterministic: true,
    storesRawDocument: false,
    enforcement: "not_enforced",
    signer: "external_vti_or_enterprise_signer_required",
  },
});

const dispatchInvginiRoute = async (request: NextRequest, method: string) => {
  const pathname = new URL(request.url).pathname;

  if (method === "GET" && pathname === "/v1/policy-artifacts/sample") {
    return Response.json(samplePolicyArtifactPayload());
  }

  if (method === "GET" && pathname === "/v1/agents/invgini-governance/fleet") {
    return listInvginiFleetRoute(request);
  }

  if (method === "GET" && pathname === "/v1/agents/invgini-governance") {
    return listInvginiProjectRegistryRoute(request);
  }

  if (
    method === "POST" &&
    pathname === "/v1/agents/invgini-governance/events"
  ) {
    return ingestInvginiEventsRoute(request);
  }

  const controlMatch = pathname.match(
    /^\/v1\/agents\/invgini-governance\/([^/]+)\/controls$/,
  );
  if (method === "POST" && controlMatch?.[1]) {
    return createInvginiControlRoute(
      request,
      decodeURIComponent(controlMatch[1]),
    );
  }

  return null;
};

const withInvginiRoutes =
  (method: string) =>
  async (request: NextRequest): Promise<Response> => {
    const invginiResponse = await dispatchInvginiRoute(request, method);
    if (invginiResponse) return invginiResponse;
    return handler(request);
  };

export const GET = withInvginiRoutes("GET");
export const POST = withInvginiRoutes("POST");
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
