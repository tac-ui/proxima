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
          // Use GET instead of HEAD — some proxies drop connection on HEAD for 5xx
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
          });
          // Consume body to avoid memory leak, but don't wait for full download
          res.body?.cancel().catch(() => {});
          clearTimeout(timeout);
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

    // Manual checks don't send notifications — scheduled checks handle state-based alerts
    return ok(results);
  } catch (err) {
    return errorResponse(err);
  }
}
