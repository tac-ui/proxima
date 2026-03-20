import { getDb, schema } from "@server/db/index";

export function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Find the most recently added SSH key path (used for SSH repo operations). */
export function findSshKeyPath(): string | undefined {
  try {
    const db = getDb();
    const key = db.select().from(schema.sshKeys).orderBy(schema.sshKeys.id).all().pop();
    return key?.keyPath;
  } catch {
    return undefined;
  }
}

export function toRepoInfo(row: typeof schema.repositories.$inferSelect) {
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
  };
}
