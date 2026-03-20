import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { GitService } from "@server/services/git";
import { getConfig } from "@server/lib/config";
import { findSshKeyPath } from "../../../_lib/repo-utils";

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
    const branches = await gitService.listRemoteBranches(repo.path, repo.repoUrl, findSshKeyPath());

    return ok({ branches, current: repo.branch });
  } catch (err) {
    return errorResponse(err);
  }
}
