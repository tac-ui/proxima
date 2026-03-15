import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { listManaged, processIdentifier } from "@server/services/managed-service";
import type { ListeningProcess, ListeningProcessWithManaged } from "@/types";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    let output: string;
    try {
      output = execSync("lsof +c 0 -iTCP -sTCP:LISTEN -P -n", {
        encoding: "utf-8",
        timeout: 5000,
      });
    } catch {
      // lsof returns exit code 1 when no results found
      return ok<ListeningProcessWithManaged[]>([]);
    }

    const lines = output.trim().split("\n");
    // Skip header line
    const dataLines = lines.slice(1);

    const processes: ListeningProcess[] = [];
    const seen = new Set<string>();

    for (const line of dataLines) {
      const parts = line.split(/\s+/);
      // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
      if (parts.length < 10) continue;

      const name = parts[0];
      const pid = parseInt(parts[1], 10);
      const user = parts[2];
      const protocol = parts[7] === "TCP" ? "TCP" : parts[7];
      const nameField = parts[8]; // e.g. *:3000 or 127.0.0.1:8080

      const colonIdx = nameField.lastIndexOf(":");
      if (colonIdx === -1) continue;

      const address = nameField.slice(0, colonIdx) || "*";
      const port = parseInt(nameField.slice(colonIdx + 1), 10);
      if (isNaN(port)) continue;

      const key = `${pid}:${port}:${protocol}`;
      if (seen.has(key)) continue;
      seen.add(key);

      processes.push({ pid, name, user, port, address, protocol });
    }

    processes.sort((a, b) => a.port - b.port);

    // Cross-reference with managed_services table
    const managed = listManaged();
    const managedMap = new Map(
      managed
        .filter((m) => m.type === "process")
        .map((m) => [m.identifier, m.id])
    );

    const result: ListeningProcessWithManaged[] = processes.map((p) => {
      const id = processIdentifier(p.name, p.port);
      const managedId = managedMap.get(id);
      return { ...p, managed: managedId !== undefined, managedId };
    });

    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
