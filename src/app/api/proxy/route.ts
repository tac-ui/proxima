import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { broadcast } from "../_lib/event-bus";
import { list, create } from "@server/services/proxy-host";
import {
  validateDomainName,
  validateForwardHost,
  validateForwardPort,
  validateForwardScheme,
} from "@server/lib/validators";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const hosts = await list();
    return ok(hosts);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as Record<string, unknown>;

    // Validate required fields
    const domainNames = body.domainNames as string[];
    if (!Array.isArray(domainNames) || domainNames.length === 0) {
      throw new Error("domainNames must be a non-empty array");
    }
    for (const d of domainNames) {
      validateDomainName(d);
    }

    validateForwardHost(body.forwardHost as string);
    validateForwardPort(body.forwardPort as number);
    validateForwardScheme(body.forwardScheme as string);

    const host = await create({
      domainNames,
      forwardScheme: body.forwardScheme as "http" | "https",
      forwardHost: body.forwardHost as string,
      forwardPort: body.forwardPort as number,
      cachingEnabled: (body.cachingEnabled as boolean) ?? false,
      blockExploits: (body.blockExploits as boolean) ?? false,
      allowWebsocketUpgrade: (body.allowWebsocketUpgrade as boolean) ?? false,
      http2Support: (body.http2Support as boolean) ?? false,
      enabled: (body.enabled as boolean) ?? true,
      locations: (body.locations as import("@/types").ProxyLocation[]) ?? [],
      meta: (body.meta as Record<string, unknown>) ?? {},
    });

    const hosts = await list();
    broadcast({ type: "proxyHostList", data: hosts as import("@/types").ProxyHost[] });

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "proxy", targetType: "proxyHost", targetName: domainNames.join(", "), ipAddress: getClientIp(req) });
    return ok(host);
  } catch (err) {
    return errorResponse(err);
  }
}
