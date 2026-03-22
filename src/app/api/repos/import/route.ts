import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getConfig } from "@server/lib/config";
import { getDb, schema } from "@server/db/index";
import { toRepoInfo } from "../../_lib/repo-utils";
import { logAudit, getClientIp } from "@server/services/audit";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";

/** GET: Scan /data/stacks/ for unregistered directories with .git */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    const config = getConfig();
    const stacksDir = config.stacksDir;

    if (!fs.existsSync(stacksDir)) return ok([]);

    const db = getDb();
    const registered = db.select({ name: schema.repositories.name }).from(schema.repositories).all();
    const registeredNames = new Set(registered.map((r) => r.name));

    const entries = fs.readdirSync(stacksDir, { withFileTypes: true });
    const unregistered: { name: string; repoUrl: string; branch: string }[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (registeredNames.has(entry.name)) continue;

      const dirPath = path.join(stacksDir, entry.name);
      const gitDir = path.join(dirPath, ".git");
      if (!fs.existsSync(gitDir)) continue;

      // Extract git info
      let repoUrl = "";
      let branch = "main";
      try {
        repoUrl = execFileSync("git", ["-C", dirPath, "config", "--get", "remote.origin.url"], { encoding: "utf-8", timeout: 5000 }).trim();
      } catch { /* no remote */ }
      try {
        branch = execFileSync("git", ["-C", dirPath, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8", timeout: 5000 }).trim();
      } catch { /* fallback to main */ }

      unregistered.push({ name: entry.name, repoUrl, branch });
    }

    return ok(unregistered);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST: Import (register) an existing git directory */
export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as { name: string };
    if (!body.name) throw new Error("name is required");

    const config = getConfig();
    const dirPath = path.join(config.stacksDir, body.name);
    const resolved = path.resolve(dirPath);

    // Security: ensure path is within stacksDir
    if (!resolved.startsWith(path.resolve(config.stacksDir) + path.sep)) {
      throw new Error("Invalid directory name");
    }

    if (!fs.existsSync(path.join(dirPath, ".git"))) {
      throw new Error("Not a git repository");
    }

    // Extract git info
    let repoUrl = "";
    let branch = "main";
    try {
      repoUrl = execFileSync("git", ["-C", dirPath, "config", "--get", "remote.origin.url"], { encoding: "utf-8", timeout: 5000 }).trim();
    } catch { /* no remote */ }
    try {
      branch = execFileSync("git", ["-C", dirPath, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf-8", timeout: 5000 }).trim();
    } catch { /* fallback */ }

    const db = getDb();
    db.insert(schema.repositories)
      .values({
        name: body.name,
        repoUrl,
        path: resolved,
        branch,
        scripts: "[]",
      })
      .onConflictDoNothing()
      .run();

    const row = db.select().from(schema.repositories).where(eq(schema.repositories.name, body.name)).get();
    if (!row) throw new Error("Failed to register repository");

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "repo", targetType: "repo", targetName: body.name, details: { repoUrl, imported: true }, ipAddress: getClientIp(req) });
    return ok(toRepoInfo(row));
  } catch (err) {
    return errorResponse(err);
  }
}
