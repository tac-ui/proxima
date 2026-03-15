import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getGithubToken, getGithubUsername } from "@server/services/github";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const token = getGithubToken();
    const username = getGithubUsername();
    const connected = !!token;

    return ok({ connected, username: connected ? (username ?? undefined) : undefined });
  } catch (err) {
    return errorResponse(err);
  }
}
