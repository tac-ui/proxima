import { type NextRequest } from "next/server";
import { getDb, schema } from "@server/db/index";
import { desc, eq, and, sql, lt, gte, lte } from "drizzle-orm";
import { logger } from "@server/lib/logger";

let insertCount = 0;

export function logAudit(params: {
  userId?: number;
  username?: string;
  action: string;
  category: string;
  targetType?: string;
  targetName?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): void {
  try {
    const db = getDb();
    db.insert(schema.auditLogs)
      .values({
        userId: params.userId ?? null,
        username: params.username ?? null,
        action: params.action,
        category: params.category,
        targetType: params.targetType ?? null,
        targetName: params.targetName ?? null,
        details: params.details ? JSON.stringify(params.details) : null,
        ipAddress: params.ipAddress ?? null,
      })
      .run();

    insertCount++;
    if (insertCount % 100 === 0) {
      cleanupOldLogs();
    }
  } catch (err) {
    logger.error("audit", `Failed to write audit log: ${err}`);
  }
}

export function getAuditLogs(params: {
  page?: number;
  limit?: number;
  userId?: number;
  category?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}): { logs: (typeof schema.auditLogs.$inferSelect)[]; total: number } {
  const db = getDb();
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.userId !== undefined) {
    conditions.push(eq(schema.auditLogs.userId, params.userId));
  }
  if (params.category) {
    conditions.push(eq(schema.auditLogs.category, params.category));
  }
  if (params.action) {
    conditions.push(eq(schema.auditLogs.action, params.action));
  }
  if (params.startDate) {
    conditions.push(gte(schema.auditLogs.createdAt, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.auditLogs.createdAt, params.endDate));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(where)
    .get();
  const total = totalResult?.count ?? 0;

  const logs = db
    .select()
    .from(schema.auditLogs)
    .where(where)
    .orderBy(desc(schema.auditLogs.id))
    .limit(limit)
    .offset(offset)
    .all();

  return { logs, total };
}

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : null)
    ?? req.headers.get("x-real-ip")
    ?? "unknown";
}

function cleanupOldLogs(): void {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    db.delete(schema.auditLogs)
      .where(lt(schema.auditLogs.createdAt, cutoff))
      .run();
  } catch (err) {
    logger.error("audit", `Failed to cleanup old audit logs: ${err}`);
  }
}
