import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getDb, dbHelpers } from "../db/index";
import { logger } from "../lib/logger";

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRY = "7d";

export interface JWTPayload {
  userId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(userId: number, username: string, role: string): string {
  const secret = getJwtSecret();
  const payload: JWTPayload = { userId, username, role };
  return jwt.sign(payload, secret, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JWTPayload {
  const secret = getJwtSecret();
  return jwt.verify(token, secret, { algorithms: ["HS256"] }) as JWTPayload;
}

export function getJwtSecret(): string {
  const db = getDb();
  const row = dbHelpers.getSetting(db, "jwtSecret");

  if (row) {
    return row.value;
  }

  // Generate and persist a new secret
  const secret = crypto.randomBytes(64).toString("hex");
  dbHelpers.setSetting(db, "jwtSecret", secret);
  logger.info("auth", "Generated new JWT secret and stored in database");
  return secret;
}

export function needsSetup(): boolean {
  const db = getDb();
  return dbHelpers.getUserCount(db) === 0;
}
