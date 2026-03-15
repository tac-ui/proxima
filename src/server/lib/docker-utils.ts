import type { StackStatus, ContainerInfo, PortMapping, NetworkInfo } from "@/types";

/**
 * Returns the base docker compose command as an argv array.
 */
export function getComposeCommand(): string[] {
  return ["docker", "compose"];
}

/**
 * Convert a docker compose ls status string to a StackStatus enum value.
 * Example input: "running(2)", "exited(1), running(1)", "created"
 */
export function statusToEnum(dockerStatus: string): StackStatus {
  if (!dockerStatus) {
    return "unknown";
  }
  const s = dockerStatus.toLowerCase();
  if (s.startsWith("created")) {
    return "created";
  }
  if (s.includes("exited")) {
    // If any service is exited we treat the whole stack as exited
    return "exited";
  }
  if (s.startsWith("running")) {
    return "running";
  }
  return "unknown";
}

/**
 * Build the full args array for a `docker compose <subcommand>` call.
 * Prepends optional env-file flags when the files exist.
 */
export function buildComposeOptions(
  stackDir: string,
  subcommand: string,
  extraArgs: string[] = [],
  globalEnvFile?: string,
  stackEnvFile?: string,
): string[] {
  // Start with: compose [--env-file ...] <subcommand> [...extraArgs]
  const opts: string[] = ["compose"];

  if (globalEnvFile) {
    opts.push("--env-file", globalEnvFile);
  }
  if (stackEnvFile) {
    opts.push("--env-file", stackEnvFile);
  }

  opts.push(subcommand, ...extraArgs);
  return opts;
}

// ---------------------------------------------------------------------------
// Raw shape returned by `docker compose ps --format json` (one JSON object
// per line, not a JSON array).
// ---------------------------------------------------------------------------
interface DockerComposePsEntry {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Image?: string;
  Publishers?: Array<{
    URL?: string;
    TargetPort?: number;
    PublishedPort?: number;
    Protocol?: string;
  }>;
  Networks?: Record<string, { IPAddress?: string; Gateway?: string }>;
}

/**
 * Parse the output of `docker compose ps --format json`.
 * Docker outputs one JSON object per line (NDJSON), not a single array.
 */
export function parseComposePs(jsonOutput: string): ContainerInfo[] {
  const results: ContainerInfo[] = [];

  const lines = jsonOutput.split("\n").filter((l) => l.trim().length > 0);

  for (const line of lines) {
    try {
      const entry: DockerComposePsEntry = JSON.parse(line);

      const ports: PortMapping[] = [];
      if (Array.isArray(entry.Publishers)) {
        for (const pub of entry.Publishers) {
          if (pub.PublishedPort && pub.PublishedPort > 0) {
            ports.push({
              hostPort: pub.PublishedPort,
              containerPort: pub.TargetPort ?? 0,
              protocol: pub.Protocol ?? "tcp",
            });
          }
        }
      }

      const networks: NetworkInfo[] = [];
      if (entry.Networks && typeof entry.Networks === "object") {
        for (const [name, info] of Object.entries(entry.Networks)) {
          networks.push({
            name,
            ipAddress: info.IPAddress ?? "",
            gateway: info.Gateway ?? "",
          });
        }
      }

      results.push({
        name: entry.Name ?? "",
        service: entry.Service ?? "",
        state: entry.State ?? "",
        status: entry.Status ?? "",
        image: entry.Image ?? "",
        ports,
        networks,
        mounts: [],
      });
    } catch {
      // skip malformed lines
    }
  }

  return results;
}
