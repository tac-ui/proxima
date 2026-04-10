import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";

/** Returns Proxima notification channel tokens for importing into OpenClaw. */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const db = getDb();
    const channels = db.select().from(schema.notificationChannels).all();

    const result: { type: string; name: string; config: Record<string, string> }[] = [];
    for (const ch of channels) {
      try {
        const config = JSON.parse(ch.config);
        result.push({ type: ch.type, name: ch.name, config });
      } catch { /* skip malformed */ }
    }

    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
