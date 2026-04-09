import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { broadcast } from "../../_lib/event-bus";
import { GitService } from "@server/services/git";
import { getConfig } from "@server/lib/config";
import { getDb, schema } from "@server/db/index";
import type { GitCloneRequest } from "@/types";
import * as path from "node:path";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as GitCloneRequest & { sshKeyId?: number };
    const { repoUrl, branch, sshKeyPath, targetDir, sshKeyId } = body;

    if (!repoUrl || !targetDir) {
      throw new Error("repoUrl and targetDir are required");
    }

    const config = getConfig();
    const sessionId = `git-${Date.now()}`;
    const gitService = new GitService(config.stacksDir);

    const result = await gitService.cloneRepo(
      { repoUrl, branch, sshKeyPath, targetDir },
      (progress) => {
        broadcast({ type: "gitProgress", data: { sessionId, progress } });
      },
    );

    // Auto-register repo in DB
    const repoName = path.basename(targetDir);
    const db = getDb();
    db.insert(schema.repositories)
      .values({
        name: repoName,
        repoUrl,
        path: result.path,
        branch: branch ?? "main",
        scripts: "[]",
        sshKeyId: sshKeyId ?? null,
      })
      .onConflictDoNothing()
      .run();

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "repo", targetType: "repo", targetName: repoName, details: { repoUrl }, ipAddress: getClientIp(req) });
    return ok({ path: result.path, composeFiles: result.composeFiles, sessionId });
  } catch (err) {
    return errorResponse(err);
  }
}
