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

function validateEnvPath(repoPath: string, relativePath: string = ".env") {
  // Prevent path traversal
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new ValidationError("Invalid path");
  }
  const envPath = path.join(repoPath, normalized);
  const resolved = path.resolve(envPath);
  const resolvedRepo = path.resolve(repoPath);
  if (!resolved.startsWith(resolvedRepo + path.sep) && resolved !== path.join(resolvedRepo, normalized)) {
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

    const filePath = req.nextUrl.searchParams.get("path") || ".env";
    const envPath = validateEnvPath(repo.path, filePath);

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
    const filePath = body.path || ".env";
    if (typeof content !== "string") {
      throw new ValidationError("content must be a string");
    }

    const envPath = validateEnvPath(repo.path, filePath);
    // Ensure parent directory exists
    const dir = path.dirname(envPath);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    await writeFile(envPath, content, "utf-8");

    return ok({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
