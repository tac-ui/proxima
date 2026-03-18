import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { name } = await params;
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);

    const args = stack.getComposeOptions("logs", "--tail", "200", "--no-color");
    const { stdout, stderr } = await execFileAsync("docker", args, {
      cwd: stack.path,
      timeout: 10_000,
    });

    return ok({ logs: stdout || stderr || "" });
  } catch (err) {
    return errorResponse(err);
  }
}
