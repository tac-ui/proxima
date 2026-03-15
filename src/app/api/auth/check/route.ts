import { type NextRequest } from "next/server";
import { errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { needsSetup } from "@server/services/auth";

export async function GET(_req: NextRequest) {
  try {
    ensureDb();
    const setup = needsSetup();
    return ok(setup);
  } catch (err) {
    return errorResponse(err);
  }
}
