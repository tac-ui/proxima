import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logAudit, getClientIp } from "@server/services/audit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const { id } = await params;
    const channelId = parseInt(id, 10);
    if (isNaN(channelId)) throw new Error("Invalid channel id");

    const db = getDb();
    const existing = db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, channelId)).get();
    if (!existing) throw new Error("Channel not found");

    const body = await req.json() as { type?: string; name?: string; config?: Record<string, string>; enabled?: boolean };

    // If type is changing, config must also be provided
    if (body.type !== undefined && body.type !== existing.type && !body.config) {
      throw new Error("config must be provided when changing channel type");
    }

    const updates: Record<string, unknown> = {};
    if (body.type !== undefined) updates.type = body.type;
    if (body.name !== undefined) updates.name = body.name;
    if (body.config !== undefined) updates.config = JSON.stringify(body.config);
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    if (Object.keys(updates).length > 0) {
      db.update(schema.notificationChannels).set(updates).where(eq(schema.notificationChannels.id, channelId)).run();
    }

    const updated = db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, channelId)).get();
    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "notification", targetType: "notification_channel", targetName: updated?.name ?? "", ipAddress: getClientIp(req) });
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
    const auth = requireManager(req);
    const { id } = await params;
    const channelId = parseInt(id, 10);
    if (isNaN(channelId)) throw new Error("Invalid channel id");

    const db = getDb();
    const existing = db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, channelId)).get();
    if (!existing) throw new Error("Channel not found");

    db.delete(schema.notificationChannels).where(eq(schema.notificationChannels.id, channelId)).run();

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "notification", targetType: "notification_channel", targetName: existing.name, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
