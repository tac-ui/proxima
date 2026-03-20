import { type NextRequest } from "next/server";
import { existsSync, chmodSync } from "node:fs";
import { requireAdmin, errorResponse, ok } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { InteractiveTerminal } from "@server/services/terminal";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { parseJson } from "../../../../../_lib/repo-utils";
import { ScriptService } from "@server/services/script";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; slug: string }> },
) {
  try {
    ensureDb();
    const auth = requireAdmin(req);

    const { id, slug } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const filename = slug.endsWith(".sh") ? slug : `${slug}.sh`;
    ScriptService.validateFilename(filename);

    const scripts = parseJson(repo.scripts) as { name: string; filename: string }[];
    const script = scripts.find((s) => s.filename === filename);
    if (!script) throw new Error("Script not found");

    const scriptPath = ScriptService.getScriptPath(repo.name, filename);

    // Verify script file exists
    if (!existsSync(scriptPath)) {
      throw new Error(`Script file not found on disk: ${filename}`);
    }

    // Ensure executable permission (may be lost on Docker volume mounts)
    try { chmodSync(scriptPath, 0o755); } catch { /* ignore */ }

    const terminalId = `repo-${repo.name}-${slug}-${Date.now()}`;

    const terminal = new InteractiveTerminal(
      terminalId,
      "/bin/bash",
      [scriptPath],
      repo.path,
    );
    terminal.start();

    logger.info("repo", `Running script "${script.name}" (${filename}) at ${scriptPath} in ${repo.path}`);
    logAudit({ userId: auth.userId, username: auth.username, action: "execute", category: "repo", targetType: "repo", targetName: repo.name, details: { script: script.name }, ipAddress: getClientIp(req) });
    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
