import type { NextRequest } from "next/server";
import { resolveInvginiControlRoute } from "@/lib/api/invgini-next-routes";

export const dynamic = "force-dynamic";

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ principalId: string; controlId: string }> },
) => {
  const { principalId, controlId } = await params;
  return resolveInvginiControlRoute(request, principalId, controlId);
};
