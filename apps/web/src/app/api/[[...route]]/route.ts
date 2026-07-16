import {
  generateSamplePolicyApprovalPreview,
  generateSamplePolicyArtifactPreview,
  generateSamplePolicyDiffExport,
} from "@onecli/api/services/policy-artifact-service";
import { app } from "@/lib/api/app";

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

const rewrite = async (request: Request) => {
  const url = new URL(request.url);
  if (url.pathname.includes("/onecomputer/policy-artifacts/sample")) {
    return Response.json(samplePolicyArtifactPayload());
  }

  url.pathname = `/v1${url.pathname.slice(4)}`;
  return app.fetch(new Request(url.toString(), request));
};

export const GET = rewrite;
export const POST = rewrite;
export const PUT = rewrite;
export const PATCH = rewrite;
export const DELETE = rewrite;
