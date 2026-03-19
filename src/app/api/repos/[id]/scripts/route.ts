import { type NextRequest } from "next/server";
import { requireAuth, requireAdmin, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { parseJson } from "../../../_lib/repo-utils";
import { ScriptService } from "@server/services/script";

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

    const scripts = parseJson(repo.scripts) as { name: string; filename: string }[];
    return ok(scripts);
  } catch (err) {
    return errorResponse(err);
  }
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

    const body = await req.json() as { name?: string; content?: string };
    const { name, content } = body;

    if (!name?.trim()) throw new Error("name is required");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const filename = ScriptService.toFilename(name.trim());
    ScriptService.validateFilename(filename);

    // Check for duplicate filename
    const scripts = parseJson(repo.scripts) as { name: string; filename: string }[];
    if (scripts.some((s) => s.filename === filename)) {
      throw new Error(`Script "${filename}" already exists`);
    }

    // Save file with default template if no content provided
    const scriptContent = content?.trim() || "#!/bin/bash\nset -e\n\n";
    ScriptService.save(repo.name, filename, scriptContent);

    // Update DB
    scripts.push({ name: name.trim(), filename });
    db.update(schema.repositories)
      .set({ scripts: JSON.stringify(scripts) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    logger.info("repo", `Created script "${name}" (${filename}) for repo ${repo.name}`);
    return ok({ name: name.trim(), filename, content: scriptContent });
  } catch (err) {
    return errorResponse(err);
  }
}
