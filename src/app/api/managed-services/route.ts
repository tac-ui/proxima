import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { listManaged, addManaged } from "@server/services/managed-service";
import type { ManagedServiceType } from "@/types";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    const rows = listManaged();
    return ok(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json() as { type: ManagedServiceType; identifier: string };
    if (!body.type || !body.identifier) {
      return ok(null);
    }
    addManaged(body.type, body.identifier);
    // Return the newly created/existing row
    const { findManaged } = await import("@server/services/managed-service");
    const row = findManaged(body.type, body.identifier);
    return ok(row);
  } catch (err) {
    return errorResponse(err);
  }
}
