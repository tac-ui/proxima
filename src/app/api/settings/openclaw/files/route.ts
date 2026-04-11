import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { ensureWorkspaceDir } from "@server/services/openclaw";
import fs from "node:fs";
import path from "node:path";

/**
 * Harness Files UI edits the SAME directory the OpenClaw agent uses as its
 * workspace (`agents.defaults.workspace` in openclaw.json). This function
 * guarantees the workspace dir exists and runs a one-time migration from
 * the legacy flat layout at /data/openclaw/*.md.
 */
function getOpenClawDir(): string {
  return ensureWorkspaceDir();
}

const ALLOWED_EXT = [".md", ".txt", ".json", ".yaml", ".yml", ".toml"];
const BLOCKED_FILES = new Set(["auth-profiles.json", "auth-state.json", "openclaw.json", ".env"]);

// Matches `.bak`, `.bak.1`, `.bak.12`, etc. — OpenClaw rotates config
// backups with a trailing numeric suffix when editing via the gateway.
function isBackupFile(name: string): boolean {
  return /\.bak(\.\d+)?$/i.test(name);
}

function assertSafePath(name: string): void {
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new ValidationError("Invalid filename");
  }
  if (BLOCKED_FILES.has(name)) {
    throw new ValidationError("This file is protected and cannot be accessed");
  }
}

function validateFilename(name: string): string {
  assertSafePath(name);
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext) && ext !== "") {
    throw new ValidationError(`File extension not allowed. Use: ${ALLOWED_EXT.join(", ")}`);
  }
  return name;
}

// Deletion is permissive for backup files (.bak / .bak.N) so users can
// clean up rotated config backups left behind by OpenClaw.
function validateFilenameForDelete(name: string): string {
  assertSafePath(name);
  if (isBackupFile(name)) return name;
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.includes(ext) && ext !== "") {
    throw new ValidationError(`File extension not allowed. Use: ${ALLOWED_EXT.join(", ")}`);
  }
  return name;
}

/** GET: list files in openclaw dir */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const dir = getOpenClawDir();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && !e.name.startsWith(".") && !BLOCKED_FILES.has(e.name))
      .map(e => ({ name: e.name, size: fs.statSync(path.join(dir, e.name)).size }));
    return ok(files);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST: create or update a file */
export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    const { name, content } = body as { name: string; content: string };
    if (!name) throw new ValidationError("Filename is required");
    const safe = validateFilename(name);
    const dir = getOpenClawDir();
    fs.writeFileSync(path.join(dir, safe), content ?? "", "utf-8");
    return ok({ name: safe });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT: read a file */
export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    const { name } = body as { name: string };
    if (!name) throw new ValidationError("Filename is required");
    const safe = validateFilename(name);
    const filePath = path.join(getOpenClawDir(), safe);
    if (!fs.existsSync(filePath)) throw new ValidationError("File not found");
    const content = fs.readFileSync(filePath, "utf-8");
    return ok({ name: safe, content });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE: remove a file */
export async function DELETE(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    const { name } = body as { name: string };
    if (!name) throw new ValidationError("Filename is required");
    const safe = validateFilenameForDelete(name);
    const filePath = path.join(getOpenClawDir(), safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
