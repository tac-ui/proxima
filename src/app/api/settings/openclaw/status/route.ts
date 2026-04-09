import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getOpenClawStatus } from "@server/services/openclaw";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    const status = getOpenClawStatus();
    return ok(status);
  } catch (err) {
    return errorResponse(err);
  }
}
