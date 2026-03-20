import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { requireManager, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { listManaged, processIdentifier } from "@server/services/managed-service";
import type { ListeningProcess, ListeningProcessWithManaged } from "@/types";

/** Detect listening TCP processes. Uses /proc/net/tcp as primary (no permissions needed). */
function detectListeningProcesses(): ListeningProcess[] {
  // Primary: /proc/net/tcp + /proc/net/tcp6 (always works, no privileges needed)
  const procNetResult = parseProcNet();
  if (procNetResult.length > 0) return procNetResult;

  // Fallback: ss (needs iproute2)
  try {
    const output = execSync("ss -tln", { encoding: "utf-8", timeout: 5000 });
    const procs = parseSs(output);
    if (procs.length > 0) return procs;
  } catch { /* fall through */ }

  // Last resort: lsof (needs privileges)
  try {
    const output = execSync("lsof +c 0 -iTCP -sTCP:LISTEN -P -n", { encoding: "utf-8", timeout: 5000 });
    const procs = parseLsof(output);
    if (procs.length > 0) return procs;
  } catch { /* fall through */ }

  return [];
}

function parseLsof(output: string): ListeningProcess[] {
  const lines = output.trim().split("\n").slice(1); // skip header
  const processes: ListeningProcess[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 10) continue;

    const name = parts[0];
    const pid = parseInt(parts[1], 10);
    const user = parts[2];
    const protocol = parts[7] === "TCP" ? "TCP" : parts[7];
    const nameField = parts[8];

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

  return processes;
}

function parseSs(output: string): ListeningProcess[] {
  const lines = output.trim().split("\n").slice(1); // skip header
  const processes: ListeningProcess[] = [];
  const seen = new Set<number>();

  for (const line of lines) {
    // State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const localAddr = parts[3]; // e.g. 0.0.0.0:3000 or *:3000 or [::]:3000
    const colonIdx = localAddr.lastIndexOf(":");
    if (colonIdx === -1) continue;

    const address = localAddr.slice(0, colonIdx) || "*";
    const port = parseInt(localAddr.slice(colonIdx + 1), 10);
    if (isNaN(port) || port === 0) continue;

    // Deduplicate by port
    if (seen.has(port)) continue;
    seen.add(port);

    // Extract PID and process name from the "users:" field (may be empty)
    let pid = 0;
    let name = "unknown";
    const processField = parts.slice(5).join(" ");
    const pidMatch = processField.match(/pid=(\d+)/);
    const nameMatch = processField.match(/\("([^"]+)"/);
    if (pidMatch) pid = parseInt(pidMatch[1], 10);
    if (nameMatch) name = nameMatch[1];

    // Try to resolve name from /proc if ss didn't provide it
    if (name === "unknown" && pid > 0) {
      try {
        name = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();
      } catch { /* ignore */ }
    }

    processes.push({ pid, name, user: "", port, address, protocol: "TCP" });
  }

  return processes;
}

/** Parse /proc/net/tcp and /proc/net/tcp6 to find listening sockets. */
function parseProcNet(): ListeningProcess[] {
  const processes: ListeningProcess[] = [];
  const seen = new Set<string>();
  const inodeToPid = buildInodeToPidMap();

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = readFileSync(file, "utf-8");
      const lines = content.trim().split("\n").slice(1); // skip header

      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10) continue;

        const state = fields[3];
        if (state !== "0A") continue; // 0A = LISTEN

        const localAddrHex = fields[1];
        const [addrHex, portHex] = localAddrHex.split(":");
        const port = parseInt(portHex, 16);
        if (isNaN(port) || port === 0) continue;

        const address = hexToIp(addrHex);
        const inode = fields[9];
        const pidInfo = inodeToPid.get(inode);

        // Deduplicate by port
        const key = `${port}`;
        if (seen.has(key)) continue;
        seen.add(key);

        processes.push({
          pid: pidInfo?.pid ?? 0,
          name: pidInfo?.name ?? "unknown",
          user: "",
          port,
          address,
          protocol: "TCP",
        });
      }
    } catch { /* file may not exist */ }
  }

  return processes;
}

function hexToIp(hex: string): string {
  if (hex.length === 8) {
    // IPv4: stored as little-endian 32-bit
    const n = parseInt(hex, 16);
    return `${n & 0xff}.${(n >> 8) & 0xff}.${(n >> 16) & 0xff}.${(n >> 24) & 0xff}`;
  }
  if (hex.length === 32) {
    // IPv6: check if all zeros (::)
    if (hex === "00000000000000000000000000000000") return "::";
    if (hex === "00000000000000000000000001000000") return "::1";
    return "::"; // simplify other IPv6
  }
  return "*";
}

function buildInodeToPidMap(): Map<string, { pid: number; name: string }> {
  const map = new Map<string, { pid: number; name: string }>();
  try {
    const pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      try {
        const fdDir = `/proc/${pid}/fd`;
        const fds = readdirSync(fdDir);
        let name = "unknown";
        try {
          name = readFileSync(`/proc/${pid}/comm`, "utf-8").trim();
        } catch { /* ignore */ }

        for (const fd of fds) {
          try {
            const link = readlinkSync(`${fdDir}/${fd}`);
            const match = link.match(/socket:\[(\d+)\]/);
            if (match) {
              map.set(match[1], { pid, name });
            }
          } catch { /* permission denied for some fds */ }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);

    const processes = detectListeningProcesses()
      .filter((p) => p.address !== "127.0.0.11"); // exclude Docker internal DNS
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
