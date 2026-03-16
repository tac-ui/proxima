import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";

function getRepo(id: number) {
  const db = getDb();
  return db.select().from(schema.repositories).where(eq(schema.repositories.id, id)).get();
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

    const envFiles = JSON.parse(repo.envFiles || "[]");
    return ok({ envFiles });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
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
    const { name, path } = body;
    if (!name || typeof name !== "string") throw new ValidationError("name is required");
    if (!path || typeof path !== "string") throw new ValidationError("path is required");

    const envFiles = JSON.parse(repo.envFiles || "[]") as { name: string; path: string }[];

    // Check for duplicate path
    if (envFiles.some((f) => f.path === path)) {
      throw new ValidationError("An env file with this path already exists");
    }

    envFiles.push({ name, path });

    const db = getDb();
    db.update(schema.repositories)
      .set({ envFiles: JSON.stringify(envFiles) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    return ok({ envFiles });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
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
    const { path } = body;
    if (!path || typeof path !== "string") throw new ValidationError("path is required");

    const envFiles = JSON.parse(repo.envFiles || "[]") as { name: string; path: string }[];
    const filtered = envFiles.filter((f) => f.path !== path);

    const db = getDb();
    db.update(schema.repositories)
      .set({ envFiles: JSON.stringify(filtered) })
      .where(eq(schema.repositories.id, repoId))
      .run();

    return ok({ envFiles: filtered });
  } catch (err) {
    return errorResponse(err);
  }
}
