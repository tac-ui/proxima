import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";

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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  try {
    ensureDb();
    requireManager(req);

    const { id, index } = await params;
    const repoId = parseInt(id, 10);
    const scriptIndex = parseInt(index, 10);

    if (isNaN(repoId)) throw new Error("Invalid repository id");
    if (isNaN(scriptIndex)) throw new Error("Invalid script index");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const scripts = parseJson(repo.scripts);
    if (scriptIndex < 0 || scriptIndex >= scripts.length) {
      throw new Error("Invalid script index");
    }

    scripts.splice(scriptIndex, 1);
    db.update(schema.repositories)
      .set({ scripts: JSON.stringify(scripts) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    logger.info("repo", `Removed script #${scriptIndex} from repo ${repo.name}`);
    return ok(toRepoInfo({ ...repo, scripts: JSON.stringify(scripts) }));
  } catch (err) {
    return errorResponse(err);
  }
}
