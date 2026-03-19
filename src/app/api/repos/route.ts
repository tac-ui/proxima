import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb, schema } from "@server/db/index";
import { toRepoInfo } from "../_lib/repo-utils";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const db = getDb();
    const repos = db.select().from(schema.repositories).all();
    return ok(repos.map(toRepoInfo));
  } catch (err) {
    return errorResponse(err);
  }
}
