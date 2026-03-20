import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { GitService } from "@server/services/git";
import { getConfig } from "@server/lib/config";
import { logger } from "@server/lib/logger";
import { findSshKeyPath } from "../../../_lib/repo-utils";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireManager(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const body = await req.json();
    const { branch } = body;
    if (!branch || typeof branch !== "string") {
      throw new ValidationError("branch is required");
    }

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const config = getConfig();
    const gitService = new GitService(config.stacksDir);

    logger.info("repo", `Checkout branch=${branch} for repo id=${repoId}`);
    const message = await gitService.checkoutBranch(repo.path, branch, repo.repoUrl, findSshKeyPath());

    // Update branch in DB
    db.update(schema.repositories)
      .set({ branch })
      .where(eq(schema.repositories.id, repoId))
      .run();

    return ok({ message, branch });
  } catch (err) {
    return errorResponse(err);
  }
}
