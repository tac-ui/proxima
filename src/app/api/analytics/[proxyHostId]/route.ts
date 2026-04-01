import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok, ValidationError } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getAnalytics } from "@server/services/cf-analytics";
import { get as getProxyHost } from "@server/services/proxy-host";

const MAX_HOURS = 720; // 30 days

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ proxyHostId: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { proxyHostId } = await params;
    const hostId = parseInt(proxyHostId, 10);
    if (isNaN(hostId) || hostId <= 0) {
      throw new ValidationError("Invalid proxy host ID");
    }

    const url = new URL(req.url);
    const rawHours = parseInt(url.searchParams.get("hours") ?? "24", 10);
    if (isNaN(rawHours) || rawHours <= 0) {
      throw new ValidationError("hours must be a positive integer");
    }
    const hours = Math.min(rawHours, MAX_HOURS);

    // Look up the proxy host to get its domains
    const host = await getProxyHost(hostId);
    if (!host.domainNames.length) {
      throw new ValidationError("Proxy host has no domain names");
    }

    const data = await getAnalytics(host.domainNames, hours);
    return ok(data);
  } catch (err) {
    return errorResponse(err);
  }
}
