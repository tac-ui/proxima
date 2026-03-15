import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    await execFileAsync("docker", ["info"], { timeout: 5000 });
    return ok({ connected: true });
  } catch (err) {
    // Docker command failed = not connected
    if (err instanceof Error && (err.message.includes("docker") || err.message.includes("ENOENT") || err.message.includes("Cannot connect"))) {
      return ok({ connected: false, error: err.message });
    }
    return errorResponse(err);
  }
}
