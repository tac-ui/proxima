import { type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import Docker from "dockerode";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ name: string; service: string }> },
) {
  try {
    ensureDb();
    requireAuth(req);

    const { name, service } = await params;
    const config = getConfig();
    const stack = await Stack.getStack(config.stacksDir, name);

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
      return new Response(`No container found for service "${service}"`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const container = docker.getContainer(containers[0].Id);
    const logBuffer = await container.logs({
      stdout: true,
      stderr: true,
      follow: false as const,
      timestamps: true,
      tail: 10000,
    });

    const logs = demuxDockerLogs(logBuffer as unknown as Buffer);
    const filename = `${name}-${service}-logs.txt`;

    return new Response(logs, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
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
