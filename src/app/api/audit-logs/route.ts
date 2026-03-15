import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getAuditLogs } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);

    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const category = url.searchParams.get("category") ?? undefined;
    const action = url.searchParams.get("action") ?? undefined;
    const userIdStr = url.searchParams.get("userId");
    const userId = userIdStr ? parseInt(userIdStr, 10) : undefined;
    const startDate = url.searchParams.get("startDate") ?? undefined;
    const endDate = url.searchParams.get("endDate") ?? undefined;

    const result = getAuditLogs({ page, limit, userId, category, action, startDate, endDate });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
