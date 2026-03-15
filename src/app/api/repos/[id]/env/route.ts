import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function getRepo(id: number) {
  const db = getDb();
  return db.select().from(schema.repositories).where(eq(schema.repositories.id, id)).get();
}

function validateEnvPath(repoPath: string) {
  const envPath = path.join(repoPath, ".env");
  const resolved = path.resolve(envPath);
  const resolvedRepo = path.resolve(repoPath);
  if (!resolved.startsWith(resolvedRepo + path.sep) && resolved !== path.join(resolvedRepo, ".env")) {
    throw new ValidationError("Invalid path");
  }
  return envPath;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireManager(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const repo = getRepo(repoId);
    if (!repo) throw new Error("Repository not found");

    const envPath = validateEnvPath(repo.path);

    try {
      const content = await readFile(envPath, "utf-8");
      return ok({ content });
    } catch {
      return ok({ content: "" });
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireManager(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const repo = getRepo(repoId);
    if (!repo) throw new Error("Repository not found");

    const body = await req.json();
    const content = body.content;
    if (typeof content !== "string") {
      throw new ValidationError("content must be a string");
    }

    const envPath = validateEnvPath(repo.path);
    await writeFile(envPath, content, "utf-8");

    return ok({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
