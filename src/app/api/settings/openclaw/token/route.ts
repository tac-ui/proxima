import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getOpenClawSettings } from "@server/services/openclaw";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    const settings = getOpenClawSettings();
    if (!settings.enabled || !settings.gatewayToken) {
      return ok({ token: "", port: settings.gatewayPort });
    }
    return ok({ token: settings.gatewayToken, port: settings.gatewayPort });
  } catch (err) {
    return errorResponse(err);
  }
}
