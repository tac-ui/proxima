import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { users, stacks, proxyHosts, settings } from "./schema";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import { ScriptService } from "../services/script";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function initDb(dataDir: string): ReturnType<typeof drizzle<typeof schema>> {
  if (_db) {
    return _db;
  }

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "proxima.db");
  logger.info("db", `Opening database at ${dbPath}`);

  _sqlite = new Database(dbPath);

  // WAL mode for better concurrency
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("synchronous = NORMAL");
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("cache_size = -12000");
  _sqlite.pragma("auto_vacuum = INCREMENTAL");

  _db = drizzle(_sqlite, { schema });

  // Create tables directly via SQL (drizzle-kit push pattern for runtime)
  createTables(_sqlite);
  migrateSchema(_sqlite);

  logger.info("db", "Database initialized successfully");
  return _db;
}

function createTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS stacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS proxy_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain_names TEXT NOT NULL DEFAULT '[]',
      forward_scheme TEXT NOT NULL DEFAULT 'http',
      forward_host TEXT NOT NULL,
      forward_port INTEGER NOT NULL DEFAULT 80,
      caching_enabled INTEGER NOT NULL DEFAULT 0,
      block_exploits INTEGER NOT NULL DEFAULT 0,
      allow_websocket_upgrade INTEGER NOT NULL DEFAULT 0,
      http2_support INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      meta TEXT NOT NULL DEFAULT '{}',
      locations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ssh_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alias TEXT NOT NULL UNIQUE,
      key_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      repo_url TEXT NOT NULL,
      path TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      scripts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS managed_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      identifier TEXT NOT NULL,
      auto_managed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS managed_services_type_identifier_unique
      ON managed_services (type, identifier);
  `);
}

function migrateSchema(sqlite: Database.Database): void {
  // v1 → v2: add role column to users
  try {
    sqlite.exec("BEGIN");
    sqlite.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`);
    // First user (lowest id) becomes admin
    sqlite.exec(`UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)`);
    sqlite.exec("COMMIT");
    logger.info("db", "Migration: added role column to users table");
  } catch (err) {
    try { sqlite.exec("ROLLBACK"); } catch { /* already rolled back */ }
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }

  // v2 → v3: add password_changed_at column
  try {
    sqlite.exec(`ALTER TABLE users ADD COLUMN password_changed_at TEXT`);
    logger.info("db", "Migration: added password_changed_at column to users table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }

  // v4 → v5: create audit_logs table
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        category TEXT NOT NULL,
        target_type TEXT,
        target_name TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
  } catch (err) {
    logger.error("db", `Audit logs migration failed: ${err}`);
  }

  // v5 → v6: add env_files column to repositories
  try {
    sqlite.exec(`ALTER TABLE repositories ADD COLUMN env_files TEXT NOT NULL DEFAULT '[]'`);
    logger.info("db", "Migration: added env_files column to repositories table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }

  // v6 → v7: create metrics_history table
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS metrics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cpu_load TEXT NOT NULL,
        memory_percent TEXT NOT NULL,
        disk_percent TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_history_timestamp ON metrics_history (timestamp)`);
  } catch (err) {
    logger.error("db", `Metrics history migration failed: ${err}`);
  }

  // v7 → v8: add hookEnabled, hookApiKey columns to repositories + webhook_logs table
  try {
    sqlite.exec(`ALTER TABLE repositories ADD COLUMN hook_enabled INTEGER NOT NULL DEFAULT 0`);
    logger.info("db", "Migration: added hook_enabled column to repositories table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }
  try {
    sqlite.exec(`ALTER TABLE repositories ADD COLUMN hook_api_key TEXT`);
    logger.info("db", "Migration: added hook_api_key column to repositories table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL,
        script_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        exit_code INTEGER,
        terminal_id TEXT,
        ip_address TEXT,
        duration INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_logs_repo_id ON webhook_logs (repo_id)`);
  } catch (err) {
    logger.error("db", `Webhook logs migration failed: ${err}`);
  }

  // v3 → v4: rename roles (superadmin→admin, admin→manager)
  try {
    const hasOld = sqlite.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role = 'superadmin'`).get() as { cnt: number };
    if (hasOld.cnt > 0) {
      sqlite.exec("BEGIN");
      sqlite.exec(`UPDATE users SET role = 'manager' WHERE role = 'admin'`);
      sqlite.exec(`UPDATE users SET role = 'admin' WHERE role = 'superadmin'`);
      sqlite.exec("COMMIT");
      logger.info("db", "Migration: renamed roles superadmin→admin, admin→manager");
    }
  } catch (err) {
    try { sqlite.exec("ROLLBACK"); } catch { /* already rolled back */ }
    logger.error("db", `Role migration failed: ${err}`);
  }

  // v8 → v9: migrate inline scripts to .sh files
  try {
    const repos = sqlite.prepare(`SELECT id, name, scripts FROM repositories`).all() as { id: number; name: string; scripts: string }[];
    for (const repo of repos) {
      let scripts: unknown[];
      try { scripts = JSON.parse(repo.scripts); } catch { continue; }
      if (!Array.isArray(scripts) || scripts.length === 0) continue;

      // Check if already migrated (new format has 'filename', old has 'command')
      const first = scripts[0] as Record<string, unknown>;
      if (first.filename && !first.command) continue;

      const newScripts: { name: string; filename: string }[] = [];
      for (const s of scripts as { name: string; command: string; preCommand?: string }[]) {
        if (!s.command) continue;
        const filename = ScriptService.toFilename(s.name);
        const lines = ["#!/bin/bash", "set -e", ""];
        if (s.preCommand) lines.push(s.preCommand);
        lines.push(s.command, "");
        try {
          ScriptService.save(repo.name, filename, lines.join("\n"));
          newScripts.push({ name: s.name, filename });
        } catch (err) {
          logger.error("db", `Migration: failed to create script file ${filename} for repo ${repo.name}: ${err}`);
        }
      }

      if (newScripts.length > 0) {
        sqlite.prepare(`UPDATE repositories SET scripts = ? WHERE id = ?`).run(JSON.stringify(newScripts), repo.id);
        logger.info("db", `Migration: migrated ${newScripts.length} scripts to files for repo ${repo.name}`);
      }
    }
  } catch (err) {
    logger.error("db", `Script file migration failed: ${err}`);
  }

  // v10 → v11: add alias column to managed_services
  try {
    sqlite.exec(`ALTER TABLE managed_services ADD COLUMN alias TEXT`);
    logger.info("db", "Migration: added alias column to managed_services table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }

  // v11 → v12: create notification_channels table
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
  } catch (err) {
    logger.error("db", `Notification channels migration failed: ${err}`);
  }

  // v9 → v10: add domain_connection column to repositories
  try {
    sqlite.exec(`ALTER TABLE repositories ADD COLUMN domain_connection TEXT`);
    logger.info("db", "Migration: added domain_connection column to repositories table");
  } catch (err) {
    if (err instanceof Error && !err.message.includes("duplicate column")) {
      throw err;
    }
  }
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _db;
}

export function closeDb(): void {
  if (_sqlite) {
    try {
      _sqlite.pragma("wal_checkpoint(TRUNCATE)");
      _sqlite.close();
      logger.info("db", "Database closed");
    } catch (err) {
      logger.error("db", err);
    } finally {
      _sqlite = null;
      _db = null;
    }
  }
}

// Typed query helpers
export const dbHelpers = {
  getUserByUsername(db: ReturnType<typeof drizzle<typeof schema>>, username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  },

  getUserById(db: ReturnType<typeof drizzle<typeof schema>>, id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  },

  getUserCount(db: ReturnType<typeof drizzle<typeof schema>>): number {
    const result = db.select().from(users).all();
    return result.length;
  },

  getSetting(db: ReturnType<typeof drizzle<typeof schema>>, key: string) {
    return db.select().from(settings).where(eq(settings.key, key)).get();
  },

  setSetting(db: ReturnType<typeof drizzle<typeof schema>>, key: string, value: string) {
    const existing = db.select().from(settings).where(eq(settings.key, key)).get();
    if (existing) {
      db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    } else {
      db.insert(settings).values({ key, value }).run();
    }
  },
};

export { schema };
