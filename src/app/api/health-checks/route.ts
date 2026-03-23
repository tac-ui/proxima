import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { getHealthCheckDomains, saveHealthCheckDomains, type HealthCheckDomain } from "@server/services/health-check";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    return ok(getHealthCheckDomains());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json() as { url: string; name: string };
    if (!body.url) throw new Error("URL is required");

    let url = body.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    const domains = getHealthCheckDomains();
    if (domains.some((d) => d.url === url)) {
      throw new Error("Domain already exists");
    }

    domains.push({ url, name: body.name?.trim() || new URL(url).hostname, addedAt: new Date().toISOString() });
    saveHealthCheckDomains(domains);
    return ok(domains);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json() as { url: string };
    const domains = getHealthCheckDomains().filter((d) => d.url !== body.url);
    saveHealthCheckDomains(domains);
    return ok(domains);
  } catch (err) {
    return errorResponse(err);
  }
}
