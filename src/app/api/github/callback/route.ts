import { type NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getConfig } from "@server/lib/config";
import { getDb, dbHelpers, schema } from "@server/db/index";
import { exchangeCodeForToken, saveGithubToken } from "@server/services/github";
import { eq } from "drizzle-orm";

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  try {
    ensureDb();

    // Verify CSRF state parameter
    const state = req.nextUrl.searchParams.get("state");
    if (!state) {
      throw new Error("Missing OAuth state parameter");
    }

    const db = getDb();
    const stored = dbHelpers.getSetting(db, `oauth_state:${state}`);
    if (!stored) {
      throw new Error("Invalid or expired OAuth state");
    }

    // Delete used state to prevent replay
    db.delete(schema.settings).where(eq(schema.settings.key, `oauth_state:${state}`)).run();

    // Check state hasn't expired
    const createdAt = parseInt(stored.value, 10);
    if (Date.now() - createdAt > OAUTH_STATE_MAX_AGE_MS) {
      throw new Error("OAuth state expired");
    }

    const code = req.nextUrl.searchParams.get("code");
    if (!code) {
      throw new Error("Missing OAuth code parameter");
    }

    const config = getConfig();
    if (!config.githubClientId || !config.githubClientSecret) {
      throw new Error("GitHub OAuth is not configured");
    }

    const { accessToken, username } = await exchangeCodeForToken(
      config.githubClientId,
      config.githubClientSecret,
      code,
    );

    saveGithubToken(accessToken, username);

    // Return HTML that notifies the opener window and closes itself
    // postMessage origin is restricted to same-origin for security
    const html = `<!DOCTYPE html><html><body><script>
      if (window.opener) { window.opener.postMessage("github-connected", window.location.origin); }
      window.close();
    </script><p>GitHub connected. You can close this window.</p></body></html>`;
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
