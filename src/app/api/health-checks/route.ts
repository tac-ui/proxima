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

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json() as {
      url: string;
      name?: string;
      newUrl?: string;
      notifyEnabled?: boolean;
      messageTemplate?: string;
      recoveryMessageTemplate?: string;
      notificationChannelIds?: number[];
    };
    if (!body.url) throw new Error("URL is required");

    const domains = getHealthCheckDomains();
    const idx = domains.findIndex((d) => d.url === body.url);
    if (idx === -1) throw new Error("Domain not found");

    if (body.name !== undefined) domains[idx].name = body.name.trim();
    if (body.newUrl) {
      let newUrl = body.newUrl.trim();
      if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
        newUrl = `https://${newUrl}`;
      }
      domains[idx].url = newUrl;
    }
    if (body.notifyEnabled !== undefined) domains[idx].notifyEnabled = body.notifyEnabled;
    if (body.messageTemplate !== undefined) domains[idx].messageTemplate = body.messageTemplate || undefined;
    if (body.recoveryMessageTemplate !== undefined) domains[idx].recoveryMessageTemplate = body.recoveryMessageTemplate || undefined;
    if (body.notificationChannelIds !== undefined) domains[idx].notificationChannelIds = body.notificationChannelIds.length > 0 ? body.notificationChannelIds : undefined;

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
