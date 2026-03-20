import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { GitService } from "@server/services/git";
import { getConfig } from "@server/lib/config";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { findSshKeyPath } from "../../../_lib/repo-utils";

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

    const config = getConfig();
    const gitService = new GitService(config.stacksDir);

    logger.info("repo", `Pulling repo id=${repoId} path=${repo.path}`);
    const message = await gitService.pullRepo(repo.path, repo.branch, repo.repoUrl, findSshKeyPath());
    logger.info("repo", `Pull result: ${message}`);

    logAudit({ userId: auth.userId, username: auth.username, action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { operation: "pull" }, ipAddress: getClientIp(req) });
    return ok({ message });
  } catch (err) {
    return errorResponse(err);
  }
}
