import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
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
    const url = new URL(req.url);
    const tail = parseInt(url.searchParams.get("tail") ?? "200", 10);
    const since = url.searchParams.get("since") ?? undefined;

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
      return ok({ logs: `No container found for service "${service}"` });
    }

    const container = docker.getContainer(containers[0].Id);
    const logOpts = {
      stdout: true,
      stderr: true,
      follow: false as const,
      tail,
      timestamps: true,
      ...(since ? { since: Math.floor(new Date(since).getTime() / 1000) } : {}),
    };

    const stream = await container.logs(logOpts);
    const logs = demuxDockerLogs(stream as unknown as Buffer);

    return ok({ logs });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Docker multiplexes stdout/stderr into a framed stream.
 * Each frame: [type(1) + 0(3) + size(4-byte BE)] + payload
 * When timestamps are enabled the output is typically plain text, but
 * we handle both cases.
 */
function demuxDockerLogs(buffer: Buffer): string {
  // If it's already a string (non-TTY with follow:false returns Buffer)
  if (typeof buffer === "string") return buffer;

  const lines: string[] = [];
  let offset = 0;

  // Check if this looks like multiplexed output (first byte is 0, 1, or 2
  // and bytes 1-3 are 0)
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
    const chunk = buffer.subarray(offset, offset + size).toString("utf-8");
    lines.push(chunk);
    offset += size;
  }

  return lines.join("");
}
