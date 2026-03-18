import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, ok, AuthError } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { InteractiveTerminal, Terminal } from "@server/services/terminal";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { getOrCreateApiKey, verifyApiKey } from "../_lib/hookKey";
import { checkRateLimit, recordFailedAttempt } from "../_lib/rate-limit";

const MAX_CONCURRENT_HOOKS = 10;

function parseScripts(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const db = getDb();
    const ip = getClientIp(req);

    // Rate limiting
    const rateLimitMsg = checkRateLimit(ip);
    if (rateLimitMsg) {
      return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
    }

    // Authenticate via API key (header only)
    const key = req.headers.get("x-api-key");
    if (!key) throw new AuthError("Missing API key");

    const storedKey = getOrCreateApiKey(db);
    if (!verifyApiKey(key, storedKey)) {
      recordFailedAttempt(ip);
      throw new AuthError("Invalid API key");
    }

    // Concurrency cap
    const activeHooks = Terminal.getAllTerminals().filter((t) => t.name.startsWith("hook-"));
    if (activeHooks.length >= MAX_CONCURRENT_HOOKS) {
      return NextResponse.json({ ok: false, error: "Too many concurrent hook executions" }, { status: 429 });
    }

    // Resolve project
    const url = new URL(req.url);
    const projectName = url.searchParams.get("project");
    if (!projectName) throw new Error("Missing 'project' parameter");

    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.name, projectName)).get();
    if (!repo) {
      logger.warn("hook", `Project "${projectName}" not found for hook request from ${ip}`);
      throw new AuthError("Invalid request");
    }

    // Resolve script
    const scriptParam = url.searchParams.get("script");
    if (!scriptParam) throw new Error("Missing 'script' parameter");

    const scripts = parseScripts(repo.scripts) as { name: string; command: string; preCommand?: string }[];
    let script: { name: string; command: string; preCommand?: string } | undefined;

    script = scripts.find((s) => s.name === scriptParam);
    if (!script) {
      const idx = parseInt(scriptParam, 10);
      if (!isNaN(idx) && idx >= 0 && idx < scripts.length) {
        script = scripts[idx];
      }
    }

    if (!script) {
      logger.warn("hook", `Script "${scriptParam}" not found in project "${projectName}" for hook request from ${ip}`);
      throw new AuthError("Invalid request");
    }

    // Execute
    const terminalId = `hook-${repo.name}-${Date.now()}`;
    const shellCommand = script.preCommand ? `${script.preCommand} && ${script.command}` : script.command;

    const terminal = new InteractiveTerminal(
      terminalId,
      "/bin/sh",
      ["-c", shellCommand],
      repo.path,
    );
    terminal.start();

    logger.info("hook", `Hook triggered script "${script.name}" in ${repo.path}: ${shellCommand}`);
    logAudit({ userId: undefined, username: "hook", action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { script: script.name }, ipAddress: ip });

    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
