import { type NextRequest } from "next/server";
import { errorResponse, ok, ValidationError } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { needsSetup, hashPassword, generateToken } from "@server/services/auth";
import { getDb, dbHelpers, schema } from "@server/db/index";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();

    if (!needsSetup()) {
      return errorResponse(new Error("Setup already completed"), "Setup already completed");
    }

    const body = await req.json() as { username?: string; password?: string };
    const { username, password } = body;

    if (!username || !password) {
      throw new ValidationError("username and password are required");
    }

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username.trim())) {
      throw new ValidationError("Username must be 3-32 characters (letters, numbers, _ or -)");
    }

    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    if (!/[0-9]/.test(password)) {
      throw new ValidationError("Password must contain at least one number");
    }
    if (!/[a-zA-Z]/.test(password)) {
      throw new ValidationError("Password must contain at least one letter");
    }

    const passwordHash = await hashPassword(password);
    const db = getDb();
    const result = db
      .insert(schema.users)
      .values({ username: username.trim(), passwordHash, role: "admin" })
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
      })
      .get();

    if (!result) {
      throw new Error("Failed to create user");
    }

    const token = generateToken(result.id, result.username, result.role);
    logAudit({ userId: result.id, username: result.username, action: "create", category: "auth", targetType: "user", targetName: result.username, ipAddress: getClientIp(req) });
    return ok({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
