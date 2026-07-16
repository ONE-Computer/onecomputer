import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { healthRoutes } from "./health";

describe("healthRoutes", () => {
  it("reports the deployment-provided source version alongside a current timestamp", async () => {
    const app = new Hono();
    app.route("/health", healthRoutes("d0438e0"));

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      version: "d0438e0",
    });
  });
});
