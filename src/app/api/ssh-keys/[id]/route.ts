import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { id } = await params;
    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) throw new Error("Invalid SSH key id");

    const db = getDb();
    const key = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, keyId)).get();
    db.delete(schema.sshKeys).where(eq(schema.sshKeys.id, keyId)).run();
    logger.info("ssh-keys", `Removed SSH key id=${keyId}`);

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "ssh-key", targetType: "sshKey", targetName: key?.alias ?? `id:${keyId}`, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
