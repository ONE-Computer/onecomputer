import type { NextRequest } from "next/server";
import { getInvginiEventLogsRoute } from "@/lib/api/invgini-next-routes";

export const dynamic = "force-dynamic";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ principalId: string }> },
) => {
  const { principalId } = await params;
  return getInvginiEventLogsRoute(request, principalId);
};
