import { type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import Docker from "dockerode";
import type { Readable } from "node:stream";
import { demuxDockerLogs } from "@server/lib/docker-log-demux";

export const dynamic = "force-dynamic";

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
      return new Response("data: No container found\n\n", {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const container = docker.getContainer(containers[0].Id);
    const logStream = (await container.logs({
      stdout: true,
      stderr: true,
      follow: true as const,
      tail: 0,
      timestamps: true,
    })) as unknown as Readable;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;

        const onAbort = () => cleanup();

        const cleanup = () => {
          if (closed) return;
          closed = true;
          logStream.removeListener("data", onData);
          logStream.removeListener("end", onEnd);
          logStream.removeListener("error", onError);
          logStream.destroy();
          req.signal.removeEventListener("abort", onAbort);
          try { controller.close(); } catch { /* already closed */ }
        };

        const onData = (chunk: Buffer) => {
          if (closed) return;
          const text = demuxDockerLogs(chunk);
          if (text) {
            const lines = text.split("\n").filter((l) => l.length > 0);
            for (const line of lines) {
              if (closed) return;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(line)}\n\n`),
              );
            }
          }
        };

        const onEnd = () => {
          if (closed) return;
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          cleanup();
        };

        const onError = () => {
          cleanup();
        };

        logStream.on("data", onData);
        logStream.on("end", onEnd);
        logStream.on("error", onError);

        req.signal.addEventListener("abort", onAbort);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
