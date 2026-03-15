import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../../_lib/auth";
import { getCloudflaredStatus } from "@server/services/cloudflared";

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    const status = await getCloudflaredStatus();
    return ok(status);
  } catch (err) {
    return errorResponse(err);
  }
}
