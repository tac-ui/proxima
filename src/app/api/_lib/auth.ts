import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@server/services/auth";
import { getDb, dbHelpers } from "@server/db/index";
import { logger } from "@server/lib/logger";
import { ensureDb } from "./db";
import { getOpenClawSettings } from "@server/services/openclaw";

export class AuthError extends Error {
  constructor(message: string = "Unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

export function requireAuth(req: NextRequest): { userId: number; username: string; role: string } {
  ensureDb();

  // Service token auth — OpenClaw gateway token grants admin access without expiry
  const serviceToken = req.headers.get("x-service-token");
  if (serviceToken) {
    const settings = getOpenClawSettings();
    if (settings.gatewayToken && serviceToken === settings.gatewayToken) {
      return { userId: 0, username: "openclaw", role: "admin" };
    }
    throw new AuthError("Invalid service token");
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header");
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const db = getDb();
    const user = dbHelpers.getUserById(db, payload.userId);

    if (!user || user.username !== payload.username) {
      throw new AuthError("User not found or token mismatch");
    }

    // Reject tokens issued before password change
    if (user.passwordChangedAt && payload.iat) {
      const changedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (payload.iat < changedAtSec) {
        throw new AuthError("Token invalidated by password change");
      }
    }

    return { userId: user.id, username: user.username, role: user.role };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("Invalid or expired token");
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function requireManager(req: NextRequest): { userId: number; username: string; role: string } {
  const auth = requireAuth(req);
  if (auth.role !== "admin" && auth.role !== "manager") {
    throw new ForbiddenError("Manager access required");
  }
  return auth;
}

export function requireAdmin(req: NextRequest): { userId: number; username: string; role: string } {
  const auth = requireAuth(req);
  if (auth.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return auth;
}

import { ValidationError } from "@server/lib/errors";
export { ValidationError };

export function errorResponse(err: unknown, defaultMsg: string = "Internal server error") {
  if (err instanceof AuthError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
  }
  // Safe to expose validation errors and errors with explicit messages passed as defaultMsg
  if (err instanceof ValidationError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  }
  // For known operational errors (e.g. "Stack not found"), use the provided defaultMsg
  if (defaultMsg !== "Internal server error") {
    return NextResponse.json({ ok: false, error: defaultMsg }, { status: 400 });
  }
  // Log internal errors server-side, return generic message to client
  logger.error("api", err instanceof Error ? err.stack ?? err.message : String(err));
  return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
}

export function ok<T>(data?: T) {
  return NextResponse.json({ ok: true, data });
}
