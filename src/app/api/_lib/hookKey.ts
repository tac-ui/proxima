import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";

export function getOrCreateApiKey(db: ReturnType<typeof getDb>): string {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, "hook_api_key")).get();
  if (existing) return existing.value;

  const newKey = randomUUID();
  db.insert(schema.settings).values({ key: "hook_api_key", value: newKey }).run();
  return newKey;
}

/** Constant-time comparison using SHA-256 hashing to normalize length */
export function verifyApiKey(provided: string, stored: string): boolean {
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(provided), hash(stored));
}
