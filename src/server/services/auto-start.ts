import { existsSync, chmodSync } from "node:fs";
import { getDb, schema } from "../db/index";
import { InteractiveTerminal } from "./terminal";
import { ScriptService } from "./script";
import { logger } from "../lib/logger";
import type { RepoScript } from "@/types";

/**
 * Run all scripts marked with autoStart on server startup.
 */
export function autoStartScripts(): void {
  try {
    const db = getDb();
    const repos = db.select().from(schema.repositories).all();

    for (const repo of repos) {
      let scripts: RepoScript[];
      try {
        scripts = JSON.parse(repo.scripts);
      } catch {
        continue;
      }

      const autoScripts = scripts.filter((s) => s.autoStart);
      for (const script of autoScripts) {
        try {
          const scriptPath = ScriptService.getScriptPath(repo.name, script.filename);
          if (!existsSync(scriptPath)) {
            logger.warn("auto-start", `Script file not found: ${script.filename} in ${repo.name}`);
            continue;
          }

          try { chmodSync(scriptPath, 0o755); } catch { /* ignore */ }

          const slug = script.filename.replace(/\.sh$/, "");
          const terminalId = `repo-${repo.name}-${slug}-${Date.now()}`;

          const terminal = new InteractiveTerminal(
            terminalId,
            "/bin/bash",
            [scriptPath],
            repo.path,
          );
          terminal.start();

          logger.info("auto-start", `Started "${script.name}" (${script.filename}) in ${repo.name}`);
        } catch (err) {
          logger.warn("auto-start", `Failed to start "${script.name}" in ${repo.name}: ${err}`);
        }
      }
    }
  } catch (err) {
    logger.warn("auto-start", `Auto-start failed: ${err}`);
  }
}
