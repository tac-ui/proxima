import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
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
