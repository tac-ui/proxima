import crypto from "node:crypto";
import { getDb, dbHelpers } from "../db/index";
import { logger } from "../lib/logger";
import { getJwtSecret } from "./auth";

const GITHUB_TOKEN_KEY = "github_oauth_token";
const GITHUB_USERNAME_KEY = "github_oauth_username";
const ENCRYPTED_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(getJwtSecret(), "utf8").digest();
}

function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

function decryptToken(storedValue: string): string {
  if (!storedValue.startsWith(ENCRYPTED_PREFIX)) {
    return storedValue;
  }

  const payload = Buffer.from(storedValue.slice(ENCRYPTED_PREFIX.length), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function getGithubToken(): string | null {
  const db = getDb();
  const row = dbHelpers.getSetting(db, GITHUB_TOKEN_KEY);
  if (!row?.value) return null;

  try {
    const token = decryptToken(row.value);
    if (!row.value.startsWith(ENCRYPTED_PREFIX)) {
      dbHelpers.setSetting(db, GITHUB_TOKEN_KEY, encryptToken(token));
      logger.info("github", "Migrated GitHub token storage to encrypted format");
    }
    return token;
  } catch (err) {
    logger.error("github", `Failed to decrypt stored GitHub token: ${err}`);
    return null;
  }
}

export function getGithubUsername(): string | null {
  const db = getDb();
  const row = dbHelpers.getSetting(db, GITHUB_USERNAME_KEY);
  return row?.value ?? null;
}

export function saveGithubToken(token: string, username: string): void {
  const db = getDb();
  dbHelpers.setSetting(db, GITHUB_TOKEN_KEY, encryptToken(token));
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
