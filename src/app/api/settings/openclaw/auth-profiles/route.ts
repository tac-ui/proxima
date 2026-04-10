import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { listAuthProfiles, upsertAuthProfile, removeAuthProfile, restartOpenClaw, getOpenClawStatus } from "@server/services/openclaw";
import { logger } from "@server/lib/logger";

/** GET: list all auth profiles */
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    const profiles = listAuthProfiles();
    return ok(profiles);
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST: add/update an auth profile */
export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    const { provider, profileId, token, expiresInDays, displayName } = body as {
      provider: string;
      profileId?: string;
      token: string;
      expiresInDays?: number;
      displayName?: string;
    };
    if (!provider) throw new ValidationError("Provider is required");
    if (!token) throw new ValidationError("Token is required");

    const result = upsertAuthProfile({ provider, profileId, token, expiresInDays, displayName });

    // Restart gateway if running to pick up new auth
    if (getOpenClawStatus().state === "running") {
      try { await restartOpenClaw(); } catch (err) { logger.warn("openclaw", `Restart after auth update: ${err}`); }
    }

    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE: remove an auth profile */
export async function DELETE(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    const { profileId } = body as { profileId: string };
    if (!profileId) throw new ValidationError("profileId is required");

    removeAuthProfile(profileId);

    // Restart gateway if running
    if (getOpenClawStatus().state === "running") {
      try { await restartOpenClaw(); } catch (err) { logger.warn("openclaw", `Restart after auth remove: ${err}`); }
    }

    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
