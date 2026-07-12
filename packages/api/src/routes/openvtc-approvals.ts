import { Hono } from "hono";
import { decideApprovalByOpenVtc } from "../services/approval-service";

/**
 * Wallet-facing approval ingress. There is deliberately no ONEComputer
 * session middleware here: a separate OpenVTC wallet authenticates the
 * decision with its signed approve-response/0.2 document. The gateway verifies
 * the proof and action binding before release.
 */
export const openVtcApprovalRoutes = () => {
  const app = new Hono();

  app.post("/:id/decide", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as {
      document?: Record<string, unknown>;
      comment?: string;
    } | null;
    if (!body?.document || typeof body.document !== "object") {
      return c.json(
        { error: "signed OpenVTC response document is required" },
        400,
      );
    }
    const updated = await decideApprovalByOpenVtc({
      bridgeId: id,
      document: body.document,
      comment: body.comment,
    });
    return c.json({ ok: true, status: updated.status, id: updated.id });
  });

  return app;
};
