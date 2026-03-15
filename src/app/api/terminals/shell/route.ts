import { type NextRequest, NextResponse } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { InteractiveTerminal, Terminal } from "@server/services/terminal";
import os from "os";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const shellCount = Terminal.getAllTerminals().filter((t) =>
      t.name.startsWith("shell-"),
    ).length;

    if (shellCount >= 10) {
      return NextResponse.json(
        { ok: false, error: "Maximum 10 shell terminals allowed" },
        { status: 400 },
      );
    }

    const shell = process.platform === "darwin" ? "zsh" : "bash";
    const terminalId = `shell-${Date.now()}`;
    const terminal = new InteractiveTerminal(terminalId, shell, [], process.env.HOME || os.homedir());
    terminal.start();

    // Verify the terminal actually started
    const check = Terminal.getTerminal(terminalId);
    if (!check) {
      return NextResponse.json(
        { ok: false, error: "Failed to start shell terminal" },
        { status: 500 },
      );
    }

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "terminal", targetType: "terminal", targetName: terminalId, ipAddress: getClientIp(req) });
    return ok({ terminalId });
  } catch (err) {
    return errorResponse(err);
  }
}
