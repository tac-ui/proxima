import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";

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
    hookEnabled: row.hookEnabled,
    hookApiKey: row.hookApiKey,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    return ok(toRepoInfo(repo));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    db.delete(schema.repositories).where(eq(schema.repositories.id, repoId)).run();
    logger.info("repo", `Deleted repo id=${repoId}`);

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "repo", targetType: "repo", targetName: repo?.name ?? `id:${repoId}`, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
