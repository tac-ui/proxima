import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    const { userId, username, role } = requireAuth(req);
    return ok({ userId, username, role });
  } catch (err) {
    return errorResponse(err);
  }
}
