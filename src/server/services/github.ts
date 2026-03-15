import { getDb, dbHelpers } from "../db/index";
import { logger } from "../lib/logger";

const GITHUB_TOKEN_KEY = "github_oauth_token";
const GITHUB_USERNAME_KEY = "github_oauth_username";

export function getGithubToken(): string | null {
  const db = getDb();
  const row = dbHelpers.getSetting(db, GITHUB_TOKEN_KEY);
  return row?.value ?? null;
}

export function getGithubUsername(): string | null {
  const db = getDb();
  const row = dbHelpers.getSetting(db, GITHUB_USERNAME_KEY);
  return row?.value ?? null;
}

export function saveGithubToken(token: string, username: string): void {
  const db = getDb();
  dbHelpers.setSetting(db, GITHUB_TOKEN_KEY, token);
  dbHelpers.setSetting(db, GITHUB_USERNAME_KEY, username);
  logger.info("github", `GitHub account connected: ${username}`);
}

export function removeGithubToken(): void {
  const db = getDb();
  dbHelpers.setSetting(db, GITHUB_TOKEN_KEY, "");
  dbHelpers.setSetting(db, GITHUB_USERNAME_KEY, "");
  logger.info("github", "GitHub account disconnected");
}

/**
 * Exchange an OAuth authorization code for an access token.
 */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<{ accessToken: string; username: string }> {
  // Exchange code for token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description ?? tokenData.error ?? "Failed to get access token");
  }

  // Get GitHub username
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });

  const userData = (await userRes.json()) as { login?: string };
  const username = userData.login ?? "unknown";

  return { accessToken: tokenData.access_token, username };
}

/**
 * Inject GitHub OAuth token into a clone URL if it's a github.com HTTPS URL.
 */
export function injectTokenIntoUrl(repoUrl: string, token: string): string {
  try {
    const url = new URL(repoUrl);
    if (url.hostname === "github.com" && url.protocol === "https:") {
      url.username = "x-access-token";
      url.password = token;
      return url.toString();
    }
  } catch {
    // Not a valid URL, return as-is
  }
  return repoUrl;
}
