import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok, ValidationError, ForbiddenError } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logAudit, getClientIp } from "@server/services/audit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireAdmin(req);

    const { id } = await params;
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new ValidationError("Invalid user ID");
    }

    if (userId === auth.userId) {
      throw new ForbiddenError("Cannot change your own role");
    }

    const body = await req.json() as { role?: string };
    const { role } = body;

    if (!role) {
      throw new ValidationError("role is required");
    }

    if (role === "admin") {
      throw new ValidationError("Cannot assign admin role");
    }

    if (role !== "manager" && role !== "viewer") {
      throw new ValidationError("Role must be manager or viewer");
    }

    const db = getDb();
    const existing = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!existing) {
      throw new ValidationError("User not found");
    }

    if (existing.role === "admin") {
      throw new ForbiddenError("Cannot change admin role");
    }

    db.update(schema.users).set({ role }).where(eq(schema.users.id, userId)).run();

    const updated = db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "user", targetType: "user", targetName: existing.username, details: { role }, ipAddress: getClientIp(req) });
    return ok(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireAdmin(req);

    const { id } = await params;
    const userId = parseInt(id, 10);
    if (isNaN(userId)) {
      throw new ValidationError("Invalid user ID");
    }

    if (userId === auth.userId) {
      throw new ForbiddenError("Cannot delete yourself");
    }

    const db = getDb();
    const existing = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!existing) {
      throw new ValidationError("User not found");
    }

    if (existing.role === "admin") {
      throw new ForbiddenError("Cannot delete admin");
    }

    db.delete(schema.users).where(eq(schema.users.id, userId)).run();

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "user", targetType: "user", targetName: existing.username, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
