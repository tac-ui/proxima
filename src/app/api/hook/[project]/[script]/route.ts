import { type NextRequest, NextResponse } from "next/server";
import { existsSync, chmodSync } from "node:fs";
import { errorResponse, ok, AuthError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { InteractiveTerminal, Terminal } from "@server/services/terminal";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { checkRateLimit, recordFailedAttempt } from "../../../_lib/rate-limit";
import { timingSafeEqual, createHash } from "node:crypto";
import { parseJson } from "../../../_lib/repo-utils";
import { ScriptService } from "@server/services/script";

const MAX_CONCURRENT_HOOKS = 10;

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

    // Resolve script by filename (slug) or name
    const scripts = parseJson(repo.scripts) as { name: string; filename: string; hookEnabled?: boolean }[];
    const slugFilename = scriptParam.endsWith(".sh") ? scriptParam : `${scriptParam}.sh`;
    let script = scripts.find((s) => s.filename === slugFilename);
    if (!script) {
      script = scripts.find((s) => s.name === scriptParam);
    }
    if (!script) {
      // Legacy: try matching by slug
      script = scripts.find((s) => ScriptService.slugify(s.name) === scriptParam);
    }

    if (!script) {
      logger.warn("hook", `Script "${scriptParam}" not found in project "${projectName}" for hook request from ${ip}`);
      throw new AuthError("Invalid request");
    }

    // Check per-script webhook toggle
    if (script.hookEnabled === false) {
      return NextResponse.json({ ok: false, error: "Webhook is disabled for this script" }, { status: 403 });
    }

    // Insert webhook log (running)
    const startTime = Date.now();
    const logEntry = db.insert(schema.webhookLogs).values({
      repoId: repo.id,
      scriptName: script.name,
      status: "running",
      ipAddress: ip,
    }).returning().get();

    // Execute via file
    const scriptPath = ScriptService.getScriptPath(repo.name, script.filename);
    if (!existsSync(scriptPath)) {
      logger.error("hook", `Script file not found: ${scriptPath}`);
      return NextResponse.json({ ok: false, error: "Script file not found" }, { status: 404 });
    }
    try { chmodSync(scriptPath, 0o755); } catch { /* ignore */ }

    const terminalId = `hook-${repo.name}-${Date.now()}`;

    const terminal = new InteractiveTerminal(
      terminalId,
      "/bin/bash",
      [scriptPath],
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

    logger.info("hook", `Hook triggered script "${script.name}" (${script.filename}) in ${repo.path}`);
    logAudit({ userId: undefined, username: "hook", action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { script: script.name }, ipAddress: ip });

    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
