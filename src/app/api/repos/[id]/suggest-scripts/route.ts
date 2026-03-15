import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface SuggestedScript {
  name: string;
  command: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const suggestions: SuggestedScript[] = [];

    // Try package.json
    try {
      const pkgRaw = await readFile(path.join(repo.path, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgRaw);
      if (pkg.scripts && typeof pkg.scripts === "object") {
        for (const [name, cmd] of Object.entries(pkg.scripts)) {
          if (typeof cmd === "string") {
            suggestions.push({ name, command: `npm run ${name}` });
          }
        }
      }
    } catch {
      // no package.json
    }

    // Try Makefile targets
    try {
      const makefile = await readFile(path.join(repo.path, "Makefile"), "utf-8");
      const targets = makefile.match(/^([a-zA-Z_][\w-]*):/gm);
      if (targets) {
        for (const t of targets) {
          const name = t.replace(":", "");
          suggestions.push({ name, command: `make ${name}` });
        }
      }
    } catch {
      // no Makefile
    }

    return ok({ suggestions });
  } catch (err) {
    return errorResponse(err);
  }
}
