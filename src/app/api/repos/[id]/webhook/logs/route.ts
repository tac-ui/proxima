import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
    const offset = (page - 1) * limit;

    const db = getDb();

    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const logs = db.select()
      .from(schema.webhookLogs)
      .where(eq(schema.webhookLogs.repoId, repoId))
      .orderBy(desc(schema.webhookLogs.id))
      .limit(limit)
      .offset(offset)
      .all();

    const totalResult = db.select({ count: sql<number>`COUNT(*)` })
      .from(schema.webhookLogs)
      .where(eq(schema.webhookLogs.repoId, repoId))
      .get();

    return ok({
      logs: logs.map((l) => ({
        id: l.id,
        repoId: l.repoId,
        scriptName: l.scriptName,
        status: l.status,
        exitCode: l.exitCode,
        terminalId: l.terminalId,
        ipAddress: l.ipAddress,
        duration: l.duration,
        createdAt: l.createdAt,
      })),
      total: totalResult?.count ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
