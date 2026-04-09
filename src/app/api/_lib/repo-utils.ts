import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";

export function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Find SSH key path for a repository. Uses repo's stored key, falls back to most recent key. */
export function findSshKeyPath(repoId?: number): string | undefined {
  try {
    const db = getDb();

    // If repo has a stored SSH key, use that
    if (repoId) {
      const repo = db.select().from(schema.repositories).where(
        eq(schema.repositories.id, repoId)
      ).get();
      if (repo?.sshKeyId) {
        const key = db.select().from(schema.sshKeys).where(
          eq(schema.sshKeys.id, repo.sshKeyId)
        ).get();
        if (key) return key.keyPath;
      }
    }

    // Fallback: if only one SSH key exists, use it; otherwise use most recent
    const allKeys = db.select().from(schema.sshKeys).orderBy(schema.sshKeys.id).all();
    if (allKeys.length === 1) return allKeys[0].keyPath;
    return allKeys.pop()?.keyPath;
  } catch {
    return undefined;
  }
}

export function toRepoInfo(row: typeof schema.repositories.$inferSelect) {
  let domainConnection = null;
  let domainConnections: unknown[] = [];
  if (row.domainConnection) {
    try {
      const parsed = JSON.parse(row.domainConnection);
      if (Array.isArray(parsed)) {
        domainConnections = parsed;
        domainConnection = parsed[0] ?? null;
      } else {
        domainConnection = parsed;
        domainConnections = [parsed];
      }
    } catch { /* ignore */ }
  }
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repoUrl,
    path: row.path,
    branch: row.branch,
    scripts: parseJson(row.scripts),
    envFiles: parseJson(row.envFiles),
    hookEnabled: row.hookEnabled,
    hookApiKey: row.hookApiKey,
    domainConnection,
    domainConnections,
    sshKeyId: row.sshKeyId ?? null,
  };
}
