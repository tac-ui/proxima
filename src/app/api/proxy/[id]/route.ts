import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { broadcast } from "../../_lib/event-bus";
import { list, update, remove } from "@server/services/proxy-host";
import {
  validateDomainName,
  validateForwardHost,
  validateForwardPort,
  validateForwardScheme,
} from "@server/lib/validators";
import type { ProxyHost } from "@/types";
import { logAudit, getClientIp } from "@server/services/audit";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { id } = await params;
    const hostId = parseInt(id, 10);
    if (isNaN(hostId)) {
      throw new Error("Invalid proxy host id");
    }

    const body = await req.json() as Record<string, unknown>;

    // Validate input fields
    if (body.domainNames) {
      const domains = body.domainNames as string[];
      if (!Array.isArray(domains) || domains.length === 0) {
        throw new Error("domainNames must be a non-empty array");
      }
      for (const d of domains) validateDomainName(d);
    }
    if (body.forwardHost !== undefined) validateForwardHost(body.forwardHost as string);
    if (body.forwardPort !== undefined) validateForwardPort(body.forwardPort as number);
    if (body.forwardScheme !== undefined) validateForwardScheme(body.forwardScheme as string);

    const updated = await update(hostId, body as Parameters<typeof update>[1]);

    const hosts = await list();
    broadcast({ type: "proxyHostList", data: hosts as ProxyHost[] });

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "proxy", targetType: "proxyHost", targetName: `id:${hostId}`, ipAddress: getClientIp(req) });
    const warnings = updated._warnings;
    return ok({ ...updated, warnings: warnings?.length ? warnings : undefined });
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
    const hostId = parseInt(id, 10);
    if (isNaN(hostId)) {
      throw new Error("Invalid proxy host id");
    }

    await remove(hostId);

    const hosts = await list();
    broadcast({ type: "proxyHostList", data: hosts as ProxyHost[] });

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "proxy", targetType: "proxyHost", targetName: `id:${hostId}`, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
