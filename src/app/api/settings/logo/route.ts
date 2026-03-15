import { type NextRequest, NextResponse } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, dbHelpers } from "@server/db/index";
import { getConfig } from "@server/lib/config";
import { promises as fs } from "node:fs";
import path from "node:path";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_SIZE = 2 * 1024 * 1024; // 2MB

function getBrandingDir() {
  const config = getConfig();
  return path.join(config.dataDir, "branding");
}

export async function GET() {
  try {
    ensureDb();
    const db = getDb();
    const logoFile = dbHelpers.getSetting(db, "branding:logoFile")?.value;
    if (!logoFile) {
      return new NextResponse(null, { status: 404 });
    }

    const filePath = path.join(getBrandingDir(), logoFile);
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(logoFile).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
      };
      const contentType = mimeMap[ext] || "application/octet-stream";
      return new NextResponse(data, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    const formData = await req.formData();
    const file = formData.get("logo") as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ ok: false, error: "Invalid file type. Allowed: PNG, JPEG, GIF, WebP" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ ok: false, error: "File too large. Maximum 2MB" }, { status: 400 });
    }

    const ext = MIME_TO_EXT[file.type] || "png";
    const filename = `logo.${ext}`;
    const brandingDir = getBrandingDir();
    await fs.mkdir(brandingDir, { recursive: true });

    // Remove old logo file if exists
    const db = getDb();
    const oldFile = dbHelpers.getSetting(db, "branding:logoFile")?.value;
    if (oldFile) {
      try { await fs.unlink(path.join(brandingDir, oldFile)); } catch { /* ignore */ }
    }

    // Save new file
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(brandingDir, filename), buffer);

    // Update DB
    dbHelpers.setSetting(db, "branding:logoFile", filename);
    dbHelpers.setSetting(db, "branding:logoUrl", "/api/settings/logo");

    return ok({ logoUrl: "/api/settings/logo" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    const db = getDb();
    const logoFile = dbHelpers.getSetting(db, "branding:logoFile")?.value;
    if (logoFile) {
      try { await fs.unlink(path.join(getBrandingDir(), logoFile)); } catch { /* ignore */ }
    }
    dbHelpers.setSetting(db, "branding:logoFile", "");
    dbHelpers.setSetting(db, "branding:logoUrl", "");

    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
