import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { broadcast } from "../_lib/event-bus";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import type { StackListItem } from "@/types";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const config = getConfig();
    const stackMap = await Stack.getStackList(config.stacksDir);
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
    return ok(items);
  } catch (err) {
    return errorResponse(err);
  }
}
