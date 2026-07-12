import { Hono } from "hono";
import type { ApiEnv } from "../types";
import { authMiddleware } from "../middleware/auth";
import {
  generateSamplePolicyApprovalPreview,
  generateSamplePolicyArtifactPreview,
  generateSamplePolicyDiffExport,
} from "../services/policy-artifact-service";

export const samplePolicyArtifactPayload = () => ({
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

export const policyArtifactRoutes = () => {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware);

  app.get("/sample", (c) => c.json(samplePolicyArtifactPayload()));

  return app;
};
