import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getAnalyticsSummary } from "@server/services/cf-analytics";
import { list as listProxyHosts } from "@server/services/proxy-host";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    // Build hostId → domains map from proxy hosts
    const hosts = await listProxyHosts();
    const domainMap = new Map<number, string[]>();
    for (const host of hosts) {
      if (host.enabled) {
        domainMap.set(host.id, host.domainNames);
      }
    }

    const summary = await getAnalyticsSummary(domainMap);
    return ok(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
