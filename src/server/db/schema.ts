import {sqliteTable, integer, text, uniqueIndex} from "drizzle-orm/sqlite-core";
import {sql} from "drizzle-orm";

export const users = sqliteTable("users", {
    id: integer("id").primaryKey({autoIncrement: true}),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("viewer"),
    passwordChangedAt: text("password_changed_at"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const stacks = sqliteTable("stacks", {
    id: integer("id").primaryKey({autoIncrement: true}),
    name: text("name").notNull().unique(),
    path: text("path").notNull(),
    status: text("status").notNull().default("created"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text("updated_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const proxyHosts = sqliteTable("proxy_hosts", {
    id: integer("id").primaryKey({autoIncrement: true}),
    domainNames: text("domain_names").notNull().default("[]"),
    forwardScheme: text("forward_scheme").notNull().default("http"),
    forwardHost: text("forward_host").notNull(),
    forwardPort: integer("forward_port").notNull().default(80),
    cachingEnabled: integer("caching_enabled", {mode: "boolean"}).notNull().default(false),
    blockExploits: integer("block_exploits", {mode: "boolean"}).notNull().default(false),
    allowWebsocketUpgrade: integer("allow_websocket_upgrade", {mode: "boolean"}).notNull().default(false),
    http2Support: integer("http2_support", {mode: "boolean"}).notNull().default(false),
    enabled: integer("enabled", {mode: "boolean"}).notNull().default(true),
    meta: text("meta").notNull().default("{}"),
    locations: text("locations").notNull().default("[]"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
    updatedAt: text("updated_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const settings = sqliteTable("settings", {
    id: integer("id").primaryKey({autoIncrement: true}),
    key: text("key").notNull().unique(),
    value: text("value").notNull(),
});

export const sshKeys = sqliteTable("ssh_keys", {
    id: integer("id").primaryKey({autoIncrement: true}),
    alias: text("alias").notNull().unique(),
    keyPath: text("key_path").notNull(),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const repositories = sqliteTable("repositories", {
    id: integer("id").primaryKey({autoIncrement: true}),
    name: text("name").notNull().unique(),
    repoUrl: text("repo_url").notNull(),
    path: text("path").notNull(),
    branch: text("branch").notNull().default("main"),
    scripts: text("scripts").notNull().default("[]"),
    envFiles: text("env_files").notNull().default("[]"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const managedServices = sqliteTable("managed_services", {
    id: integer("id").primaryKey({autoIncrement: true}),
    type: text("type").notNull(),              // "container" | "process"
    identifier: text("identifier").notNull(),  // "stackName/serviceName" | "processName:port"
    autoManaged: integer("auto_managed", {mode: "boolean"}).notNull().default(false),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
}, (table) => [
    uniqueIndex("managed_services_type_identifier_unique").on(table.type, table.identifier),
]);

export const metricsHistory = sqliteTable("metrics_history", {
    id: integer("id").primaryKey({autoIncrement: true}),
    cpuLoad: text("cpu_load").notNull(),
    memoryPercent: text("memory_percent").notNull(),
    diskPercent: text("disk_percent").notNull(),
    timestamp: text("timestamp")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

export const auditLogs = sqliteTable("audit_logs", {
    id: integer("id").primaryKey({autoIncrement: true}),
    userId: integer("user_id"),
    username: text("username"),
    action: text("action").notNull(),
    category: text("category").notNull(),
    targetType: text("target_type"),
    targetName: text("target_name"),
    details: text("details"),
    ipAddress: text("ip_address"),
    createdAt: text("created_at")
        .notNull()
        .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
});

// Inferred types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Stack = typeof stacks.$inferSelect;
export type NewStack = typeof stacks.$inferInsert;
export type ProxyHost = typeof proxyHosts.$inferSelect;
export type NewProxyHost = typeof proxyHosts.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type SshKey = typeof sshKeys.$inferSelect;
export type NewSshKey = typeof sshKeys.$inferInsert;
export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
export type ManagedServiceRow = typeof managedServices.$inferSelect;
export type NewManagedServiceRow = typeof managedServices.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type MetricsHistoryRow = typeof metricsHistory.$inferSelect;
export type NewMetricsHistoryRow = typeof metricsHistory.$inferInsert;
