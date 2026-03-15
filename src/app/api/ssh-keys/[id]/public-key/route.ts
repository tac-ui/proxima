import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import fs from "node:fs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) throw new Error("Invalid SSH key id");

    const db = getDb();
    const key = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, keyId)).get();
    if (!key) throw new Error("SSH key not found");

    const pubPath = `${key.keyPath}.pub`;
    if (!fs.existsSync(pubPath)) {
      return ok({ publicKey: null });
    }

    const publicKey = fs.readFileSync(pubPath, "utf-8").trim();
    return ok({ publicKey });
  } catch (err) {
    return errorResponse(err);
  }
}
