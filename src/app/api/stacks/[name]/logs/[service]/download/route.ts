import { type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import Docker from "dockerode";
import { demuxDockerLogs } from "@server/lib/docker-log-demux";

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
