import { NextRequest } from "next/server";
import os from "os";
import { execFileSync } from "child_process";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb } from "@server/db/index";
import { metricsHistory } from "@server/db/schema";
import { lt } from "drizzle-orm";
import type { SystemMetrics } from "@/types";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function getDiskUsage(): { totalBytes: number; usedBytes: number; availableBytes: number; usagePercent: number; mountPoint: string } {
  try {
    const output = execFileSync("df", ["-B1", "/"], { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n");
    if (lines.length < 2) throw new Error("Unexpected df output");
    const parts = lines[1].split(/\s+/);
    const totalBytes = parseInt(parts[1], 10);
    const usedBytes = parseInt(parts[2], 10);
    const availableBytes = parseInt(parts[3], 10);
    const mountPoint = parts[5] || "/";
    const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
    return { totalBytes, usedBytes, availableBytes, usagePercent, mountPoint };
  } catch {
    // Fallback for systems where df -B1 is not available (e.g. macOS)
    try {
      const output = execFileSync("df", ["-k", "/"], { encoding: "utf-8", timeout: 5000 });
      const lines = output.trim().split("\n");
      if (lines.length < 2) throw new Error("Unexpected df output");
      const parts = lines[1].split(/\s+/);
      const totalBytes = parseInt(parts[1], 10) * 1024;
      const usedBytes = parseInt(parts[2], 10) * 1024;
      const availableBytes = parseInt(parts[3], 10) * 1024;
      const mountPoint = parts[parts.length - 1] || "/";
      const usagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
      return { totalBytes, usedBytes, availableBytes, usagePercent, mountPoint };
    } catch {
      return { totalBytes: 0, usedBytes: 0, availableBytes: 0, usagePercent: 0, mountPoint: "/" };
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const loadAvg = os.loadavg() as [number, number, number];
    const uptimeSec = os.uptime();

    const metrics: SystemMetrics = {
      cpu: {
        model: cpus[0]?.model || "Unknown",
        cores: cpus.length,
        loadAvg,
      },
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usagePercent: Math.round((usedMem / totalMem) * 1000) / 10,
      },
      disk: getDiskUsage(),
      os: {
        type: os.type(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
      },
      uptime: {
        seconds: uptimeSec,
        formatted: formatUptime(uptimeSec),
      },
      timestamp: new Date().toISOString(),
    };

    // Record to metrics_history
    try {
      const db = getDb();
      db.insert(metricsHistory).values({
        cpuLoad: String(metrics.cpu.loadAvg[0]),
        memoryPercent: String(metrics.memory.usagePercent),
        diskPercent: String(metrics.disk.usagePercent),
        timestamp: metrics.timestamp,
      }).run();

      // Prune entries older than 24 hours
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      db.delete(metricsHistory).where(lt(metricsHistory.timestamp, cutoff)).run();
    } catch {
      // non-critical — don't fail the response
    }

    return ok(metrics);
  } catch (err) {
    return errorResponse(err);
  }
}
