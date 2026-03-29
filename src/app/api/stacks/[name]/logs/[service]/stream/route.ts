import { type NextRequest } from "next/server";
import { requireAuth, errorResponse } from "../../../../../_lib/auth";
import { ensureDb } from "../../../../../_lib/db";
import { Stack } from "@server/services/stack";
import { getConfig } from "@server/lib/config";
import Docker from "dockerode";
import type { Readable } from "node:stream";

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

        const onData = (chunk: Buffer) => {
          const text = demuxChunk(chunk);
          if (text) {
            const lines = text.split("\n").filter((l) => l.length > 0);
            for (const line of lines) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(line)}\n\n`),
              );
            }
          }
        };

        const onEnd = () => {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        };

        const onError = () => {
          controller.close();
        };

        logStream.on("data", onData);
        logStream.on("end", onEnd);
        logStream.on("error", onError);

        req.signal.addEventListener("abort", () => {
          logStream.removeListener("data", onData);
          logStream.removeListener("end", onEnd);
          logStream.removeListener("error", onError);
          logStream.destroy();
          controller.close();
        });
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

function demuxChunk(chunk: Buffer): string {
  if (typeof chunk === "string") return chunk;

  const lines: string[] = [];
  let offset = 0;

  const isMultiplexed =
    chunk.length >= 8 &&
    (chunk[0] === 0 || chunk[0] === 1 || chunk[0] === 2) &&
    chunk[1] === 0 &&
    chunk[2] === 0 &&
    chunk[3] === 0;

  if (!isMultiplexed) {
    return chunk.toString("utf-8");
  }

  while (offset < chunk.length) {
    if (offset + 8 > chunk.length) break;
    const size = chunk.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > chunk.length) break;
    lines.push(chunk.subarray(offset, offset + size).toString("utf-8"));
    offset += size;
  }

  return lines.join("");
}
