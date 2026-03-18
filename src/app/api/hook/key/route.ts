import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getOrCreateApiKey } from "../../_lib/hookKey";

/** GET — return current API key (create if absent) */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);

    const db = getDb();
    const key = getOrCreateApiKey(db);
    return ok({ key });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — regenerate API key */
export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);

    const db = getDb();
    const newKey = randomUUID();

    const existing = db.select().from(schema.settings).where(eq(schema.settings.key, "hook_api_key")).get();
    if (existing) {
      db.update(schema.settings).set({ value: newKey }).where(eq(schema.settings.key, "hook_api_key")).run();
    } else {
      db.insert(schema.settings).values({ key: "hook_api_key", value: newKey }).run();
    }

    return ok({ key: newKey });
  } catch (err) {
    return errorResponse(err);
  }
}
