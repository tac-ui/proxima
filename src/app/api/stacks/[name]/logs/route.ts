import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Docker from "dockerode";

const execFileAsync = promisify(execFile);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { name } = await params;
    const url = new URL(req.url);
    const service = url.searchParams.get("service");
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);

    // If a specific service is requested, use dockerode for per-container logs
    if (service) {
      const docker = new Docker();
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: [
            `com.docker.compose.project=${stack.name}`,
            `com.docker.compose.service=${service}`,
          ],
        },
      });

      if (containers.length === 0) {
        return ok({ logs: `No container found for service "${service}"` });
      }

      const container = docker.getContainer(containers[0].Id);
      const logBuffer = await container.logs({
        stdout: true,
        stderr: true,
        follow: false as const,
        tail: 200,
        timestamps: true,
      });

      const logs = demuxDockerLogs(logBuffer as unknown as Buffer);
      return ok({ logs });
    }

    // Default: combined logs via docker compose
    const args = stack.getComposeOptions("logs", "--tail", "200", "--no-color");
    const { stdout, stderr } = await execFileAsync("docker", args, {
      cwd: stack.path,
      timeout: 10_000,
    });

    return ok({ logs: stdout || stderr || "" });
  } catch (err) {
    return errorResponse(err);
  }
}

function demuxDockerLogs(buffer: Buffer): string {
  if (typeof buffer === "string") return buffer;

  const lines: string[] = [];
  let offset = 0;

  const isMultiplexed =
    buffer.length >= 8 &&
    (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2) &&
    buffer[1] === 0 &&
    buffer[2] === 0 &&
    buffer[3] === 0;

  if (!isMultiplexed) {
    return buffer.toString("utf-8");
  }

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) break;
    const size = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > buffer.length) break;
    lines.push(buffer.subarray(offset, offset + size).toString("utf-8"));
    offset += size;
  }

  return lines.join("");
}
