import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { requireManager, errorResponse } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getConfig } from "@server/lib/config";
import { getDb, dbHelpers } from "@server/db/index";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    const config = getConfig();
    if (!config.githubClientId) {
      throw new Error("GitHub OAuth is not configured (missing GITHUB_CLIENT_ID)");
    }

    // Generate CSRF state token and store in DB
    const state = crypto.randomBytes(32).toString("hex");
    const db = getDb();
    dbHelpers.setSetting(db, `oauth_state:${state}`, String(Date.now()));

    const redirectUri = `${req.nextUrl.origin}/api/github/callback`;
    const githubOAuthUrl = new URL("https://github.com/login/oauth/authorize");
    githubOAuthUrl.searchParams.set("client_id", config.githubClientId);
    githubOAuthUrl.searchParams.set("redirect_uri", redirectUri);
    githubOAuthUrl.searchParams.set("scope", "repo read:user");
    githubOAuthUrl.searchParams.set("state", state);

    return NextResponse.redirect(githubOAuthUrl.toString());
  } catch (err) {
    return errorResponse(err);
  }
}
