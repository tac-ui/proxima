import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { removeGithubToken } from "@server/services/github";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    removeGithubToken();
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
