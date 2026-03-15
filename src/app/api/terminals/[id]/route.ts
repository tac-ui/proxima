import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { Terminal } from "@server/services/terminal";
import { NextResponse } from "next/server";
import { logAudit, getClientIp } from "@server/services/audit";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const { id } = await params;
    const terminal = Terminal.getTerminal(id);
    if (!terminal) {
      return NextResponse.json({ ok: false, error: "Terminal not found" }, { status: 404 });
    }

    terminal.kill();
    terminal.removeFromMap();
    logAudit({ userId: auth.userId, username: auth.username, action: "delete", category: "terminal", targetType: "terminal", targetName: id, ipAddress: getClientIp(req) });
    return ok();
  } catch (err) {
    return errorResponse(err);
  }
}
