import { type NextRequest, NextResponse } from "next/server";
import { errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { checkRateLimit, recordFailedAttempt, clearAttempts } from "../../_lib/rate-limit";
import { verifyPassword, generateToken } from "@server/services/auth";
import { getDb, dbHelpers } from "@server/db/index";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();

    // Use x-forwarded-for only first entry (set by trusted reverse proxy), fallback to x-real-ip
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = (forwarded ? forwarded.split(",")[0].trim() : null)
      ?? req.headers.get("x-real-ip")
      ?? "unknown";

    const ipRateLimitMsg = checkRateLimit(ip);
    if (ipRateLimitMsg) {
      return NextResponse.json({ ok: false, error: ipRateLimitMsg }, { status: 429 });
    }

    const body = await req.json() as { username?: string; password?: string };
    const { username, password } = body;

    if (!username || !password) {
      return errorResponse(new Error("username and password are required"));
    }

    // Also rate-limit by username to prevent distributed brute-force
    const userKey = `user:${username}`;
    const userRateLimitMsg = checkRateLimit(userKey);
    if (userRateLimitMsg) {
      return NextResponse.json({ ok: false, error: userRateLimitMsg }, { status: 429 });
    }

    const db = getDb();
    const user = dbHelpers.getUserByUsername(db, username);

    if (!user) {
      recordFailedAttempt(ip);
      recordFailedAttempt(userKey);
      logAudit({ action: "login_failed", category: "auth", details: { username }, ipAddress: getClientIp(req) });
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      recordFailedAttempt(ip);
      recordFailedAttempt(userKey);
      logAudit({ userId: user.id, username: user.username, action: "login_failed", category: "auth", ipAddress: getClientIp(req) });
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    clearAttempts(ip);
    clearAttempts(userKey);
    const token = generateToken(user.id, user.username, user.role);
    logAudit({ userId: user.id, username: user.username, action: "login", category: "auth", ipAddress: getClientIp(req) });
    return ok({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
