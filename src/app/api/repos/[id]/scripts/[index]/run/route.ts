import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { InteractiveTerminal } from "@server/services/terminal";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";

function parseScripts(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  try {
    ensureDb();
    const auth = requireAdmin(req);

    const { id, index } = await params;
    const repoId = parseInt(id, 10);
    const scriptIndex = parseInt(index, 10);

    if (isNaN(repoId)) throw new Error("Invalid repository id");
    if (isNaN(scriptIndex)) throw new Error("Invalid script index");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const scripts = parseScripts(repo.scripts);
    if (scriptIndex < 0 || scriptIndex >= scripts.length) {
      throw new Error("Invalid script index");
    }

    const script = scripts[scriptIndex] as { name: string; command: string; preCommand?: string };
    const terminalId = `repo-${repo.name}-s${scriptIndex}-${Date.now()}`;
    const shellCommand = script.preCommand ? `${script.preCommand} && ${script.command}` : script.command;

    const terminal = new InteractiveTerminal(
      terminalId,
      "/bin/sh",
      ["-c", shellCommand],
      repo.path,
    );
    terminal.start();

    logger.info("repo", `Running script "${script.name}" in ${repo.path}: ${shellCommand}`);
    logAudit({ userId: auth.userId, username: auth.username, action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { script: script.name }, ipAddress: getClientIp(req) });
    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
