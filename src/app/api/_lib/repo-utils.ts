import { schema } from "@server/db/index";

export function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
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
