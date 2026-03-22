import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { eq } from "drizzle-orm";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";
import { toRepoInfo } from "../../_lib/repo-utils";
import { ScriptService } from "@server/services/script";
import { create as createProxyHost, remove as removeProxyHost, update as updateProxyHost } from "@server/services/proxy-host";
import type { DomainConnection } from "@/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { id } = await params;
    const db = getDb();

    // Accept both numeric ID and name
    const repoId = parseInt(id, 10);
    const repo = isNaN(repoId)
      ? db.select().from(schema.repositories).where(eq(schema.repositories.name, decodeURIComponent(id))).get()
      : db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    return ok(toRepoInfo(repo));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    if (!repo) throw new Error("Repository not found");

    const body = await req.json();
    const { domainConnection, removeDomain } = body as {
      domainConnection?: DomainConnection | null;
      removeDomain?: string; // domain string to remove
    };

    // Parse existing connections (support both legacy single and array format)
    let connections: DomainConnection[] = [];
    if (repo.domainConnection) {
      try {
        const parsed = JSON.parse(repo.domainConnection);
        connections = Array.isArray(parsed) ? parsed : [parsed];
      } catch { /* ignore */ }
    }

    const proxyWarnings: string[] = [];

    if (removeDomain) {
      // Remove a specific domain connection
      const toRemove = connections.find((c) => c.domain === removeDomain);
      if (toRemove?.proxyHostId) {
        try { await removeProxyHost(toRemove.proxyHostId); } catch { /* may already be deleted */ }
      }
      connections = connections.filter((c) => c.domain !== removeDomain);
    } else if (domainConnection) {
      // Add a new domain connection
      const result = await createProxyHost({
        domainNames: [domainConnection.domain],
        forwardScheme: domainConnection.forwardScheme,
        forwardHost: domainConnection.forwardHost,
        forwardPort: domainConnection.forwardPort,
        enabled: true,
        meta: { repoId, type: "domain-connection" },
      });
      domainConnection.proxyHostId = result.id;
      if (result._warnings?.length) proxyWarnings.push(...result._warnings);
      connections.push(domainConnection);
    } else if (domainConnection === null) {
      // Remove all domain connections
      for (const conn of connections) {
        if (conn.proxyHostId) {
          try { await removeProxyHost(conn.proxyHostId); } catch { /* may already be deleted */ }
        }
      }
      connections = [];
    }

    db.update(schema.repositories)
      .set({ domainConnection: connections.length > 0 ? JSON.stringify(connections) : null })
      .where(eq(schema.repositories.id, repoId))
      .run();

    const updated = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "repo", targetType: "repo", targetName: repo.name, ipAddress: getClientIp(req) });
    const repoInfo = toRepoInfo(updated!);
    return ok(proxyWarnings.length ? { ...repoInfo, warnings: proxyWarnings } : repoInfo);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { id } = await params;
    const repoId = parseInt(id, 10);
    if (isNaN(repoId)) throw new Error("Invalid repository id");

    const db = getDb();
    const repo = db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId)).get();
    db.delete(schema.repositories).where(eq(schema.repositories.id, repoId)).run();

    // Clean up scripts directory
    if (repo) {
      try { ScriptService.deleteProjectDir(repo.name); } catch { /* ignore */ }
    }

    logger.info("repo", `Deleted repo id=${repoId}`);

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "repo", targetType: "repo", targetName: repo?.name ?? `id:${repoId}`, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
