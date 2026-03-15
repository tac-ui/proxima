import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { broadcast } from "../../../_lib/event-bus";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import type { StackListItem } from "@/types";

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
  try {
    ensureDb();
    requireManager(req);

    const { name } = await params;
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);
    await stack.restart(undefined as any);
    await broadcastStackList(config.stacksDir);

    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
