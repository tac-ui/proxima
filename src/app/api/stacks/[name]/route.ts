import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { broadcast } from "../../_lib/event-bus";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import type { StackListItem } from "@/types";
import { logAudit, getClientIp } from "@server/services/audit";
import { notify } from "@server/services/notification";

async function broadcastStackList(stacksDir: string) {
  try {
    const stackMap = await Stack.getStackList(stacksDir);
    const items: StackListItem[] = [];
    for (const stack of stackMap.values()) {
      const json = stack.toSimpleJSON() as { name: string; status: import("@/types").StackStatus };
      items.push({
        name: json.name,
        status: json.status,
        containerCount: 0,
        updatedAt: new Date().toISOString(),
      });
    }
    broadcast({ type: "stackList", data: items });
  } catch {
    // best-effort
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    ensureDb();
    const auth = requireAuth(req);

    const { name } = await params;
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);
    await stack.updateStatus();
    const containers = await stack.ps();
    const json = await stack.toJSON() as Record<string, unknown>;

    // Redact secrets for viewer role
    if (auth.role === "viewer") {
      return ok({ ...json, composeENV: "", containers });
    }

    return ok({ ...json, containers });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { name } = await params;
    const body = await req.json() as { yaml?: string; env?: string; isNew?: boolean; dockerfiles?: Record<string, string> };
    const { yaml = "", env = "", isNew = false, dockerfiles } = body;

    const config = getConfig();
    const stack = new Stack(config.stacksDir, name, yaml, env, false, dockerfiles);
    await stack.save(isNew);
    await broadcastStackList(config.stacksDir);

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "stack", targetType: "stack", targetName: name, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { name } = await params;
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);
    await stack.delete();
    await broadcastStackList(config.stacksDir);

    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "stack", targetType: "stack", targetName: name, ipAddress: getClientIp(req) });
    notify({ type: "stack.down", target: name }).catch(() => {});
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
