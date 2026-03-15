import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { verifyPassword, hashPassword } from "@server/services/auth";
import { getDb, dbHelpers, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logAudit, getClientIp } from "@server/services/audit";

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireAuth(req);

    const body = await req.json() as { currentPassword?: string; newPassword?: string };
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      throw new ValidationError("currentPassword and newPassword are required");
    }

    if (newPassword.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    if (!/[0-9]/.test(newPassword)) {
      throw new ValidationError("Password must contain at least one number");
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      throw new ValidationError("Password must contain at least one letter");
    }

    const db = getDb();
    const user = dbHelpers.getUserById(db, auth.userId);
    if (!user) {
      throw new ValidationError("User not found");
    }

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new ValidationError("Current password is incorrect");
    }

    const passwordHash = await hashPassword(newPassword);
    const passwordChangedAt = new Date().toISOString();
    db.update(schema.users).set({ passwordHash, passwordChangedAt }).where(eq(schema.users.id, auth.userId)).run();

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "user", targetType: "user", targetName: auth.username, details: { field: "password" }, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
