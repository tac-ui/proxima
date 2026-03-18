import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
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

    const url = new URL(req.url);
    const rawLimit = parseInt(url.searchParams.get("limit") || "10", 10);
    const limit = Math.min(Math.max(isNaN(rawLimit) ? 10 : rawLimit, 1), 50);

    const { stdout } = await execFileAsync(
      "git",
      ["log", `--max-count=${limit}`, "--format=%H%n%h%n%s%n%an%n%aI", "--no-color"],
      { cwd: repo.path, timeout: 10000 },
    );

    const lines = stdout.trim().split("\n");
    const commits: CommitInfo[] = [];

    for (let i = 0; i + 4 < lines.length; i += 5) {
      commits.push({
        hash: lines[i],
        shortHash: lines[i + 1],
        message: lines[i + 2],
        author: lines[i + 3],
        date: lines[i + 4],
      });
    }

    return ok({ commits });
  } catch (err) {
    return errorResponse(err);
  }
}
