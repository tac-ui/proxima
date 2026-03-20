import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function maskApiKey(storedHash: string): string {
  return `sk-••••${storedHash.slice(-4)}`;
}

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

    return ok({
      hookEnabled: repo.hookEnabled,
      hookApiKey: repo.hookApiKey ? maskApiKey(repo.hookApiKey) : null,
    });
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
    let rawKeyForResponse: string | null = null;

    if (body.apiKey !== undefined) {
      // Caller provided a custom key — hash it before storing
      rawKeyForResponse = body.apiKey;
      hookApiKey = hashApiKey(body.apiKey);
    } else if (body.enabled && !hookApiKey) {
      // Auto-generate a new key — hash before storing, return raw once
      const newKey = randomUUID();
      rawKeyForResponse = newKey;
      hookApiKey = hashApiKey(newKey);
    }

    db.update(schema.repositories)
      .set({ hookEnabled: body.enabled, hookApiKey })
      .where(eq(schema.repositories.id, repoId))
      .run();

    return ok({
      hookEnabled: body.enabled,
      // Return the raw key only when a new key was generated/set; otherwise return masked
      hookApiKey: rawKeyForResponse ?? (hookApiKey ? maskApiKey(hookApiKey) : null),
      ...(rawKeyForResponse ? { rawApiKey: rawKeyForResponse } : {}),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
