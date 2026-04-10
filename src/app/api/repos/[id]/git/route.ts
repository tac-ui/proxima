import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { GitService } from "@server/services/git";
import { getConfig } from "@server/lib/config";
import { logAudit, getClientIp } from "@server/services/audit";
import { findSshKeyPath } from "../../../_lib/repo-utils";

/** GET: changed files + env tracking check */
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

    const config = getConfig();
    const gitService = new GitService(config.stacksDir);

    const changes = await gitService.getChangedFiles(repo.path);

    // Check if env files are tracked by git
    let envFiles: { path: string; tracked: boolean }[] = [];
    try {
      const parsed = JSON.parse(repo.envFiles || "[]") as { name: string; path: string }[];
      for (const ef of parsed) {
        const tracked = await gitService.isTrackedByGit(repo.path, ef.path);
        envFiles.push({ path: ef.path, tracked });
      }
      // Also check default .env
      const dotEnvTracked = await gitService.isTrackedByGit(repo.path, ".env");
      if (dotEnvTracked) envFiles.push({ path: ".env", tracked: true });
    } catch { /* ignore */ }

    return ok({ changes, envFiles });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST: commit or push */
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

    const body = await req.json();
    const { action, message } = body as { action: "commit" | "push"; message?: string };
    const config = getConfig();
    const gitService = new GitService(config.stacksDir);

    let result: string;
    if (action === "commit") {
      if (!message?.trim()) throw new Error("Commit message is required");
      result = await gitService.commitChanges(repo.path, message);
    } else if (action === "push") {
      result = await gitService.pushChanges(repo.path, repo.branch, repo.repoUrl, findSshKeyPath(repoId));
    } else {
      throw new Error("Invalid action. Must be commit or push.");
    }

    logAudit({ userId: auth.userId, username: auth.username, action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { operation: action }, ipAddress: getClientIp(req) });
    return ok({ message: result });
  } catch (err) {
    return errorResponse(err);
  }
}
