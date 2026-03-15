import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { Terminal } from "@server/services/terminal";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const terminals = Terminal.getAllTerminals()
      .filter((t) => t.name.startsWith("repo-") || t.name.startsWith("shell-"))
      .map((t) => ({
        id: t.name,
        type: t.name.startsWith("shell-") ? ("shell" as const) : ("repo" as const),
      }));

    return ok(terminals);
  } catch (err) {
    return errorResponse(err);
  }
}
