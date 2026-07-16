import type { NextRequest } from "next/server";
import { createInvginiControlRoute } from "@/lib/api/invgini-next-routes";

export const dynamic = "force-dynamic";

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ principalId: string }> },
) => {
  const { principalId } = await params;
  return createInvginiControlRoute(request, principalId);
};
