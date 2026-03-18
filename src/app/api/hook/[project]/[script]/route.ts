import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, ok, AuthError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { InteractiveTerminal, Terminal } from "@server/services/terminal";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { checkRateLimit, recordFailedAttempt } from "../../../_lib/rate-limit";
import { timingSafeEqual, createHash } from "node:crypto";

const MAX_CONCURRENT_HOOKS = 10;

function parseScripts(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function verifyApiKey(provided: string, stored: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(provided), hash(stored));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ project: string; script: string }> },
) {
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

    const { project: projectName, script: scriptParam } = await params;

    // Resolve project
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.name, projectName)).get();
    if (!repo) {
      logger.warn("hook", `Project "${projectName}" not found for hook request from ${ip}`);
      recordFailedAttempt(ip);
      throw new AuthError("Invalid request");
    }

    // Check hookEnabled
    if (!repo.hookEnabled) {
      return NextResponse.json({ ok: false, error: "Webhook is disabled for this project" }, { status: 403 });
    }

    // Verify project-specific API key
    if (!repo.hookApiKey || !verifyApiKey(key, repo.hookApiKey)) {
      recordFailedAttempt(ip);
      throw new AuthError("Invalid API key");
    }

    // Concurrency cap
    const activeHooks = Terminal.getAllTerminals().filter((t) => t.name.startsWith("hook-"));
    if (activeHooks.length >= MAX_CONCURRENT_HOOKS) {
      return NextResponse.json({ ok: false, error: "Too many concurrent hook executions" }, { status: 429 });
    }

    // Resolve script
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

    // Insert webhook log (running)
    const startTime = Date.now();
    const logEntry = db.insert(schema.webhookLogs).values({
      repoId: repo.id,
      scriptName: script.name,
      status: "running",
      ipAddress: ip,
    }).returning().get();

    // Execute
    const terminalId = `hook-${repo.name}-${Date.now()}`;
    const shellCommand = script.preCommand ? `${script.preCommand} && ${script.command}` : script.command;

    const terminal = new InteractiveTerminal(
      terminalId,
      "/bin/sh",
      ["-c", shellCommand],
      repo.path,
    );

    // Update webhook log on exit
    terminal.onExit((exitCode: number) => {
      const duration = Date.now() - startTime;
      const status = exitCode === 0 ? "success" : "failed";
      try {
        db.update(schema.webhookLogs)
          .set({ status, exitCode, duration, terminalId })
          .where(eq(schema.webhookLogs.id, logEntry.id))
          .run();
      } catch (err) {
        logger.error("hook", `Failed to update webhook log: ${err}`);
      }
    });

    terminal.start();

    logger.info("hook", `Hook triggered script "${script.name}" in ${repo.path}: ${shellCommand}`);
    logAudit({ userId: undefined, username: "hook", action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { script: script.name }, ipAddress: ip });

    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
