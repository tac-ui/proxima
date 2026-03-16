import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
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
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAdmin(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const body = await req.json() as { name?: string; command?: string };
    const { name, command } = body;

    if (!name || !command) {
      throw new Error("name and command are required");
    }

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const scripts = parseJson(repo.scripts);
    scripts.push({ name: name.trim(), command: command.trim() });

    db.update(schema.repositories)
      .set({ scripts: JSON.stringify(scripts) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    logger.info("repo", `Added script "${name}" to repo ${repo.name}`);
    return ok(toRepoInfo({ ...repo, scripts: JSON.stringify(scripts) }));
  } catch (err) {
    return errorResponse(err);
  }
}
