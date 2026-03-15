import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { NetworkDiscovery } from "@server/services/network-discovery";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stackName: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { stackName } = await params;
    const discovery = new NetworkDiscovery();
    const suggestion = await discovery.suggestProxyTarget(stackName);

    return ok(suggestion);
  } catch (err) {
    return errorResponse(err);
  }
}
