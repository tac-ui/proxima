import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok, ValidationError } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { hashPassword } from "@server/services/auth";
import { getDb, schema } from "@server/db/index";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);

    const db = getDb();
    const allUsers = db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .all();

    return ok(allUsers);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireAdmin(req);

    const body = await req.json() as { username?: string; password?: string; role?: string };
    const { username, password, role } = body;

    if (!username || !password || !role) {
      throw new ValidationError("username, password, and role are required");
    }

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username.trim())) {
      throw new ValidationError("Username must be 3-32 characters (letters, numbers, _ or -)");
    }

    if (role === "admin") {
      throw new ValidationError("Cannot create admin users");
    }

    if (role !== "manager" && role !== "viewer") {
      throw new ValidationError("Role must be manager or viewer");
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
      .values({ username: username.trim(), passwordHash, role })
      .returning({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .get();

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "user", targetType: "user", targetName: username.trim(), ipAddress: getClientIp(req) });
    return ok(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
      return errorResponse(new ValidationError("Username already exists"));
    }
    return errorResponse(err);
  }
}
