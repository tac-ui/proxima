import { type NextRequest, NextResponse } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { InteractiveTerminal, Terminal } from "@server/services/terminal";
import fs from "fs";
import { logAudit, getClientIp } from "@server/services/audit";

function detectShell(): string {
  if (process.platform === "darwin") return "zsh";
  if (fs.existsSync("/bin/bash")) return "bash";
  return "sh";
}

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

    const shell = detectShell();
    const terminalId = `shell-${Date.now()}`;
    const cwd = process.env.PXM_STACKS_DIR || process.env.PXM_DATA_DIR || "/data";
    const terminal = new InteractiveTerminal(terminalId, shell, [], cwd);
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
