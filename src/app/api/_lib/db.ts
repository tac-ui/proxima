import fs from "node:fs";
import { initDb, getDb } from "@server/db/index";
import { getConfig } from "@server/lib/config";

let _initialized = false;

export function ensureDb() {
  if (_initialized) {
    return getDb();
  }

  const config = getConfig();

  // Ensure required data directories exist
  for (const dir of [config.dataDir, config.stacksDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = initDb(config.dataDir);
  _initialized = true;
  return db;
}
