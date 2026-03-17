import { NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb } from "@server/db/index";
import { metricsHistory } from "@server/db/schema";
import { gte } from "drizzle-orm";
import { asc } from "drizzle-orm";
import type { MetricsHistoryPoint } from "@/types";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const hoursParam = req.nextUrl.searchParams.get("hours");
    const hours = Math.min(Math.max(parseInt(hoursParam || "1", 10) || 1, 1), 24);

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const db = getDb();

    const rows = db
      .select()
      .from(metricsHistory)
      .where(gte(metricsHistory.timestamp, since))
      .orderBy(asc(metricsHistory.timestamp))
      .all();

    const points: MetricsHistoryPoint[] = rows.map((r) => ({
      timestamp: r.timestamp,
      cpuLoad: parseFloat(r.cpuLoad),
      memoryPercent: parseFloat(r.memoryPercent),
      diskPercent: parseFloat(r.diskPercent),
    }));

    return ok({ points });
  } catch (err) {
    return errorResponse(err);
  }
}
