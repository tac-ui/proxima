import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { getConfig } from "@server/lib/config";
import { logger } from "@server/lib/logger";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as { alias?: string };
    const { alias } = body;

    if (!alias || alias.trim().length === 0) {
      throw new ValidationError("alias is required");
    }

    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(alias.trim())) {
      throw new ValidationError("Alias must be 1-64 characters (letters, numbers, _ or -)");
    }

    const config = getConfig();
    const sshDir = path.join(config.dataDir, "ssh-keys");
    if (!fs.existsSync(sshDir)) {
      fs.mkdirSync(sshDir, { recursive: true });
    }

    const keyName = alias.trim();
    const keyPath = path.join(sshDir, keyName);

    if (fs.existsSync(keyPath)) {
      throw new ValidationError("A key with this alias already exists");
    }

    // Generate ed25519 key pair (no passphrase)
    execFileSync("ssh-keygen", [
      "-t", "ed25519",
      "-C", `${keyName}@proxima`,
      "-f", keyPath,
      "-N", "",
    ], { timeout: 10000 });

    const publicKey = fs.readFileSync(`${keyPath}.pub`, "utf-8").trim();

    // Store in database
    const db = getDb();
    const result = db
      .insert(schema.sshKeys)
      .values({ alias: keyName, keyPath })
      .returning()
      .get();

    if (!result) throw new Error("Failed to store SSH key");

    logger.info("ssh-keys", `Generated SSH key: ${keyName} at ${keyPath}`);
    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "ssh-key", targetType: "sshKey", targetName: keyName, details: { generated: true }, ipAddress: getClientIp(req) });

    return ok({
      id: result.id,
      alias: result.alias,
      keyPath: result.keyPath,
      publicKey,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
