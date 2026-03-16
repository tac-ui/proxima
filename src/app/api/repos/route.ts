import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb, schema } from "@server/db/index";

function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function toRepoInfo(row: typeof schema.repositories.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repoUrl,
    path: row.path,
    branch: row.branch,
    scripts: parseJson(row.scripts),
    envFiles: parseJson(row.envFiles),
  };
}

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
