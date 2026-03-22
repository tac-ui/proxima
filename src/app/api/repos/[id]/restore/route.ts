import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { execFileSync } from "node:child_process";

export async function POST(
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
    if (!repo) throw new Error("Repository not found");

    // Discard all local changes
    execFileSync("git", ["restore", "."], { cwd: repo.path, timeout: 10000 });
    // Also clean untracked files
    execFileSync("git", ["clean", "-fd"], { cwd: repo.path, timeout: 10000 });

    logger.info("repo", `Restored repo ${repo.name} (discarded all changes)`);
    logAudit({ userId: auth.userId, username: auth.username, action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { operation: "restore" }, ipAddress: getClientIp(req) });
    return ok({ message: "All changes discarded" });
  } catch (err) {
    return errorResponse(err);
  }
}
