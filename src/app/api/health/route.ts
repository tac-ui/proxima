import { type NextRequest, NextResponse } from "next/server";
import { ensureDb } from "../_lib/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function GET(_req: NextRequest) {
  // Check DB connectivity
  let dbOk = false;
  try {
    ensureDb();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  // Check Docker socket (degraded but not unhealthy if down)
  let dockerOk = false;
  try {
    await execFileAsync("docker", ["info"], { timeout: 3000 });
    dockerOk = true;
  } catch {
    dockerOk = false;
  }

  const body = {
    ok: dbOk,
    data: {
      status: dbOk ? "ok" : "degraded",
      db: dbOk,
      docker: dockerOk,
      uptime: process.uptime(),
    },
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
