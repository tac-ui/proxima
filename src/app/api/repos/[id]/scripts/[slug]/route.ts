import { type NextRequest } from "next/server";
import { requireAuth, requireAdmin, requireManager, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { parseJson } from "../../../../_lib/repo-utils";
import { ScriptService } from "@server/services/script";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id, slug } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const filename = slug.endsWith(".sh") ? slug : `${slug}.sh`;
    ScriptService.validateFilename(filename);

    const scripts = parseJson(repo.scripts) as { name: string; filename: string }[];
    const script = scripts.find((s) => s.filename === filename);
    if (!script) throw new Error("Script not found");

    const content = ScriptService.read(repo.name, filename);
    return ok({ name: script.name, filename: script.filename, content });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  try {
    ensureDb();
    requireAdmin(req);

    const { id, slug } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const body = await req.json() as { content?: string; name?: string; hookEnabled?: boolean };

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const filename = slug.endsWith(".sh") ? slug : `${slug}.sh`;
    ScriptService.validateFilename(filename);

    const scripts = parseJson(repo.scripts) as { name: string; filename: string; hookEnabled?: boolean }[];
    const scriptIndex = scripts.findIndex((s) => s.filename === filename);
    if (scriptIndex === -1) throw new Error("Script not found");

    let dbDirty = false;

    // Update file content
    if (body.content !== undefined) {
      ScriptService.save(repo.name, filename, body.content);
    }

    // Update name if provided
    if (body.name?.trim() && body.name.trim() !== scripts[scriptIndex].name) {
      scripts[scriptIndex].name = body.name.trim();
      dbDirty = true;
    }

    // Update hookEnabled
    if (body.hookEnabled !== undefined) {
      scripts[scriptIndex].hookEnabled = body.hookEnabled;
      dbDirty = true;
    }

    if (dbDirty) {
      db.update(schema.repositories)
        .set({ scripts: JSON.stringify(scripts) })
        .where(eq(schema.repositories.id, repoId))
        .run();
    }

    const content = ScriptService.read(repo.name, filename);
    logger.info("repo", `Updated script "${scripts[scriptIndex].name}" (${filename}) in repo ${repo.name}`);
    return ok({ name: scripts[scriptIndex].name, filename, content, hookEnabled: scripts[scriptIndex].hookEnabled });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  try {
    ensureDb();
    requireManager(req);

    const { id, slug } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const filename = slug.endsWith(".sh") ? slug : `${slug}.sh`;
    ScriptService.validateFilename(filename);

    const scripts = parseJson(repo.scripts) as { name: string; filename: string }[];
    const filtered = scripts.filter((s) => s.filename !== filename);

    if (filtered.length === scripts.length) {
      throw new Error("Script not found");
    }

    // Delete file
    ScriptService.delete(repo.name, filename);

    // Update DB
    db.update(schema.repositories)
      .set({ scripts: JSON.stringify(filtered) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    logger.info("repo", `Deleted script ${filename} from repo ${repo.name}`);
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
