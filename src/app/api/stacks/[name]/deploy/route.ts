import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { broadcast } from "../../../_lib/event-bus";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  try {
    ensureDb();
    const auth = requireManager(req);

    const body = await req.json() as { yaml?: string; env?: string; isNew?: boolean; dockerfiles?: Record<string, string> };
    const { yaml = "", env = "", isNew = false, dockerfiles } = body;

    const config = getConfig();
    const stack = new Stack(config.stacksDir, name, yaml, env, false, dockerfiles);
    await stack.save(isNew);

    try {
      await stack.deploy();
    } catch (deployErr) {
      notify({ type: "deploy.failed", target: name }).catch(() => {});
      throw deployErr;
    }

    await broadcastStackList(config.stacksDir);

    logAudit({ userId: auth.userId, username: auth.username, action: "deploy", category: "stack", targetType: "stack", targetName: name, ipAddress: getClientIp(req) });
    notify({ type: "deploy.success", target: name }).catch(() => {});
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
