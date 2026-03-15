import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getDb, dbHelpers } from "@server/db/index";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET() {
  try {
    ensureDb();
    const db = getDb();
    const appName = dbHelpers.getSetting(db, "branding:appName")?.value ?? "";
    const logoUrl = dbHelpers.getSetting(db, "branding:logoUrl")?.value ?? "";
    const faviconUrl = dbHelpers.getSetting(db, "branding:faviconUrl")?.value ?? "";
    const showLogo = dbHelpers.getSetting(db, "branding:showLogo")?.value !== "false";
    const showAppName = dbHelpers.getSetting(db, "branding:showAppName")?.value !== "false";
    const ogTitle = dbHelpers.getSetting(db, "branding:ogTitle")?.value ?? "";
    const ogDescription = dbHelpers.getSetting(db, "branding:ogDescription")?.value ?? "";
    return ok({ appName, logoUrl, faviconUrl, showLogo, showAppName, ogTitle, ogDescription });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const db = getDb();
    const body = await req.json();

    if (typeof body.appName === "string") {
      dbHelpers.setSetting(db, "branding:appName", body.appName);
    }
    if (typeof body.logoUrl === "string") {
      dbHelpers.setSetting(db, "branding:logoUrl", body.logoUrl);
    }
    if (typeof body.faviconUrl === "string") {
      dbHelpers.setSetting(db, "branding:faviconUrl", body.faviconUrl);
    }
    if (typeof body.showLogo === "boolean") {
      dbHelpers.setSetting(db, "branding:showLogo", String(body.showLogo));
    }
    if (typeof body.showAppName === "boolean") {
      dbHelpers.setSetting(db, "branding:showAppName", String(body.showAppName));
    }
    if (typeof body.ogTitle === "string") {
      dbHelpers.setSetting(db, "branding:ogTitle", body.ogTitle);
    }
    if (typeof body.ogDescription === "string") {
      dbHelpers.setSetting(db, "branding:ogDescription", body.ogDescription);
    }

    const appName = dbHelpers.getSetting(db, "branding:appName")?.value ?? "";
    const logoUrl = dbHelpers.getSetting(db, "branding:logoUrl")?.value ?? "";
    const faviconUrl = dbHelpers.getSetting(db, "branding:faviconUrl")?.value ?? "";
    const showLogo = dbHelpers.getSetting(db, "branding:showLogo")?.value !== "false";
    const showAppName = dbHelpers.getSetting(db, "branding:showAppName")?.value !== "false";
    const ogTitle = dbHelpers.getSetting(db, "branding:ogTitle")?.value ?? "";
    const ogDescription = dbHelpers.getSetting(db, "branding:ogDescription")?.value ?? "";
    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "settings", targetType: "setting", targetName: "branding", ipAddress: getClientIp(req) });
    return ok({ appName, logoUrl, faviconUrl, showLogo, showAppName, ogTitle, ogDescription });
  } catch (err) {
    return errorResponse(err);
  }
}
