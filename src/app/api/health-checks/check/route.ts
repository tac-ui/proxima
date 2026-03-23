import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";

export interface HealthCheckResult {
  url: string;
  status: "up" | "down";
  statusCode?: number;
  responseTime: number;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    const body = await req.json() as { urls: string[] };
    if (!body.urls?.length) return ok([]);

    const results: HealthCheckResult[] = await Promise.all(
      body.urls.map(async (url): Promise<HealthCheckResult> => {
        const start = Date.now();
        try {
          const res = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(10000),
          });
          return {
            url,
            status: res.ok ? "up" : "down",
            statusCode: res.status,
            responseTime: Date.now() - start,
          };
        } catch (err) {
          return {
            url,
            status: "down",
            responseTime: Date.now() - start,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    return ok(results);
  } catch (err) {
    return errorResponse(err);
  }
}
