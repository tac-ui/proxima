import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb, schema } from "@server/db/index";
import { logger } from "@server/lib/logger";
import { validateSshKeyPath } from "@server/lib/validators";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const db = getDb();
    const keys = db.select().from(schema.sshKeys).all();
    return ok(keys.map((k) => ({ id: k.id, alias: k.alias, keyPath: k.keyPath })));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as { alias?: string; keyPath?: string };
    const { alias, keyPath } = body;

    if (!alias || !keyPath) {
      throw new Error("alias and keyPath are required");
    }

    const validatedPath = validateSshKeyPath(keyPath.trim());

    const db = getDb();
    const result = db
      .insert(schema.sshKeys)
      .values({ alias: alias.trim(), keyPath: validatedPath })
      .returning()
      .get();

    if (!result) throw new Error("Failed to insert SSH key");

    logger.info("ssh-keys", `Added SSH key: ${result.alias} -> ${result.keyPath}`);
    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "ssh-key", targetType: "sshKey", targetName: result.alias, ipAddress: getClientIp(req) });
    return ok({ id: result.id, alias: result.alias, keyPath: result.keyPath });
  } catch (err) {
    return errorResponse(err);
  }
}
