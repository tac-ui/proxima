import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/** GET — return webhook config for a project */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAdmin(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    return ok({ hookEnabled: repo.hookEnabled, hookApiKey: repo.hookApiKey });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT — update webhook config for a project */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAdmin(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const body = await req.json() as { enabled: boolean; apiKey?: string };

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    let hookApiKey = repo.hookApiKey;

    if (body.apiKey !== undefined) {
      hookApiKey = body.apiKey;
    } else if (body.enabled && !hookApiKey) {
      hookApiKey = randomUUID();
    }

    db.update(schema.repositories)
      .set({ hookEnabled: body.enabled, hookApiKey })
      .where(eq(schema.repositories.id, repoId))
      .run();

    return ok({ hookEnabled: body.enabled, hookApiKey: hookApiKey! });
  } catch (err) {
    return errorResponse(err);
  }
}
