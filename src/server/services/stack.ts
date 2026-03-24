import fs from "node:fs";
import { promises as fsAsync } from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import yaml from "yaml";
import { logger } from "../lib/logger";
import {
  Terminal,
  InteractiveTerminal,
  getComposeTerminalName,
  getCombinedTerminalName,
  getContainerExecTerminalName,
  COMBINED_TERMINAL_ROWS,
  COMBINED_TERMINAL_COLS,
  TERMINAL_ROWS,
} from "./terminal";
import { statusToEnum, parseComposePs } from "../lib/docker-utils";
import { ValidationError } from "../lib/errors";
import Docker from "dockerode";
import type { StackStatus, ContainerInfo, MountInfo } from "@/types";
import type { AppSocket } from "./terminal";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Resolve docker binary path once at startup
// ---------------------------------------------------------------------------
function resolveDockerBin(): string {
  // Common locations for docker CLI on macOS and Linux
  const candidates = [
    "/usr/local/bin/docker",
    "/usr/bin/docker",
    "/opt/homebrew/bin/docker",
  ];
  try {
    const result = execFileSync("which", ["docker"], { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // fall through to candidates
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "docker";
}

const DOCKER_BIN = resolveDockerBin();

// ---------------------------------------------------------------------------
// Accepted compose file names (same as Dockge)
// ---------------------------------------------------------------------------
const ACCEPTED_COMPOSE_FILENAMES = [
  "compose.yaml",
  "compose.yml",
  "docker-compose.yaml",
  "docker-compose.yml",
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsAsync.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------
export class Stack {
  name: string;
  protected _status: StackStatus = "unknown";
  protected _composeYAML?: string;
  protected _composeENV?: string;
  protected _dockerfiles?: Record<string, string>;
  protected _configFilePath?: string;
  protected _composeFileName: string = "compose.yaml";

  /** Root directory that contains all stacks (e.g. ./data/stacks) */
  protected stacksDir: string;

  protected static managedStackList: Map<string, Stack> = new Map();

  constructor(
    stacksDir: string,
    name: string,
    composeYAML?: string,
    composeENV?: string,
    skipFSOperations: boolean = false,
    dockerfiles?: Record<string, string>,
  ) {
    // Validate name early before any filesystem operations
    if (!name.match(/^[a-z0-9_-]+$/)) {
      throw new ValidationError(
        "Stack name can only contain lowercase letters, digits, underscores, and hyphens",
      );
    }

    this.stacksDir = stacksDir;
    this.name = name;
    this._composeYAML = composeYAML;
    this._composeENV = composeENV;
    this._dockerfiles = dockerfiles;

    if (!skipFSOperations) {
      // Verify resolved path stays within stacksDir
      const resolved = path.resolve(path.join(stacksDir, name));
      if (!resolved.startsWith(path.resolve(stacksDir))) {
        throw new ValidationError("Invalid stack name: path traversal detected");
      }

      for (const filename of ACCEPTED_COMPOSE_FILENAMES) {
        if (fs.existsSync(path.join(this.path, filename))) {
          this._composeFileName = filename;
          break;
        }
      }
    }
  }

  // ----- paths -----------------------------------------------------------

  get path(): string {
    return path.join(this.stacksDir, this.name);
  }

  get fullPath(): string {
    const dir = this.path;
    return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
  }

  // ----- lazy-loaded file getters ----------------------------------------

  get composeYAML(): string {
    if (this._composeYAML === undefined) {
      try {
        this._composeYAML = fs.readFileSync(
          path.join(this.path, this._composeFileName),
          "utf-8",
        );
      } catch {
        this._composeYAML = "";
      }
    }
    return this._composeYAML;
  }

  get composeENV(): string {
    if (this._composeENV === undefined) {
      try {
        this._composeENV = fs.readFileSync(
          path.join(this.path, ".env"),
          "utf-8",
        );
      } catch {
        this._composeENV = "";
      }
    }
    return this._composeENV;
  }

  get dockerfiles(): Record<string, string> {
    if (this._dockerfiles === undefined) {
      this._dockerfiles = {};
      try {
        const entries = fs.readdirSync(this.path);
        for (const entry of entries) {
          if (entry === "Dockerfile" || entry.startsWith("Dockerfile.")) {
            const content = fs.readFileSync(path.join(this.path, entry), "utf-8");
            this._dockerfiles[entry] = content;
          }
        }
      } catch {
        // directory may not exist yet
      }
    }
    return this._dockerfiles;
  }

  get status(): StackStatus {
    return this._status;
  }

  get isManagedByProxima(): boolean {
    try {
      return fs.existsSync(this.path) && fs.statSync(this.path).isDirectory();
    } catch {
      return false;
    }
  }

  // ----- validation ------------------------------------------------------

  validate(): void {
    if (!this.name.match(/^[a-z0-9_-]+$/)) {
      throw new ValidationError(
        "Stack name can only contain lowercase letters, digits, underscores, and hyphens",
      );
    }

    // Validate YAML syntax
    try {
      yaml.parse(this.composeYAML);
    } catch (e) {
      throw new ValidationError(
        `Invalid compose YAML: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Validate .env format
    const lines = this.composeENV.split("\n");
    if (
      lines.length === 1 &&
      lines[0].length > 0 &&
      !lines[0].includes("=") &&
      !lines[0].startsWith("#")
    ) {
      throw new ValidationError("Invalid .env format: single-line value must contain '='");
    }
  }

  // ----- compose options -------------------------------------------------

  /**
   * Build the args array that follows `docker` for a compose subcommand.
   * Inserts --env-file flags when the relevant files exist.
   */
  getComposeOptions(subcommand: string, ...extraArgs: string[]): string[] {
    const opts: string[] = ["compose"];

    const globalEnv = path.join(this.stacksDir, "global.env");
    if (fs.existsSync(globalEnv)) {
      opts.push("--env-file", "../global.env");
      const localEnv = path.join(this.path, ".env");
      if (fs.existsSync(localEnv)) {
        opts.push("--env-file", "./.env");
      }
    }

    opts.push(subcommand, ...extraArgs);
    return opts;
  }

  // ----- disk I/O --------------------------------------------------------

  async save(isAdd: boolean): Promise<void> {
    this.validate();

    const dir = this.path;

    if (isAdd) {
      if (await fileExists(dir)) {
        throw new ValidationError("Stack name already exists");
      }
      await fsAsync.mkdir(dir, { recursive: true });
    } else {
      if (!await fileExists(dir)) {
        throw new ValidationError("Stack not found");
      }
    }

    // Write compose file
    await fsAsync.writeFile(
      path.join(dir, this._composeFileName),
      this.composeYAML,
      "utf-8",
    );

    // Write .env only when there is content or an existing .env
    const envPath = path.join(dir, ".env");
    if ((await fileExists(envPath)) || this.composeENV.trim() !== "") {
      await fsAsync.writeFile(envPath, this.composeENV, "utf-8");
    }

    // Write Dockerfiles & remove stale ones
    if (this._dockerfiles !== undefined) {
      // Find existing Dockerfiles on disk to detect removals
      try {
        const entries = await fsAsync.readdir(dir);
        for (const entry of entries) {
          if ((entry === "Dockerfile" || entry.startsWith("Dockerfile.")) && !(entry in this._dockerfiles)) {
            await fsAsync.unlink(path.join(dir, entry));
          }
        }
      } catch {
        // dir may be freshly created
      }

      for (const [filename, content] of Object.entries(this._dockerfiles)) {
        // Validate Dockerfile filename to prevent path traversal
        if (!/^Dockerfile(\.[a-zA-Z0-9_-]+)?$/.test(filename)) {
          throw new ValidationError(`Invalid Dockerfile name: ${filename}`);
        }
        const resolvedPath = path.resolve(path.join(dir, filename));
        if (!resolvedPath.startsWith(path.resolve(dir))) {
          throw new ValidationError(`Invalid Dockerfile path: ${filename}`);
        }
        if (content.trim() !== "") {
          await fsAsync.writeFile(resolvedPath, content, "utf-8");
        }
      }
    }
  }

  // ----- dockerode helpers (non-managed stacks) --------------------------

  private async getProjectContainers(): Promise<Docker.ContainerInfo[]> {
    const docker = new Docker();
    return docker.listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${this.name}`] },
    });
  }

  private async getProjectNetworks(): Promise<Docker.NetworkInspectInfo[]> {
    const docker = new Docker();
    return docker.listNetworks({
      filters: { label: [`com.docker.compose.project=${this.name}`] },
    });
  }

  // ----- docker operations -----------------------------------------------

  async deploy(socket?: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      throw new Error(
        "Cannot deploy an external stack: compose file is not managed by Proxima.",
      );
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("up", "-d", "--remove-orphans"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to deploy. Check terminal output for details.");
    }
    return exitCode;
  }

  async start(socket?: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      const docker = new Docker();
      const containers = await this.getProjectContainers();
      if (containers.length === 0) {
        throw new Error(`No containers found for stack "${this.name}".`);
      }
      for (const info of containers) {
        if (info.State !== "running") {
          await docker.getContainer(info.Id).start();
        }
      }
      return 0;
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("up", "-d", "--remove-orphans"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to start. Check terminal output for details.");
    }
    return exitCode;
  }

  async stop(socket?: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      const docker = new Docker();
      const containers = await this.getProjectContainers();
      if (containers.length === 0) {
        throw new Error(`No containers found for stack "${this.name}".`);
      }
      for (const info of containers) {
        if (info.State === "running") {
          await docker.getContainer(info.Id).stop();
        }
      }
      return 0;
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("stop"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to stop. Check terminal output for details.");
    }
    return exitCode;
  }

  async restart(socket?: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      const docker = new Docker();
      const containers = await this.getProjectContainers();
      if (containers.length === 0) {
        throw new Error(`No containers found for stack "${this.name}".`);
      }
      for (const info of containers) {
        await docker.getContainer(info.Id).restart();
      }
      return 0;
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("restart"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to restart. Check terminal output for details.");
    }
    return exitCode;
  }

  async down(socket: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      const docker = new Docker();
      const containers = await this.getProjectContainers();
      for (const info of containers) {
        const c = docker.getContainer(info.Id);
        if (info.State === "running") {
          await c.stop();
        }
        await c.remove();
      }
      const networks = await this.getProjectNetworks();
      for (const net of networks) {
        await docker.getNetwork(net.Id).remove();
      }
      return 0;
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("down"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to bring down. Check terminal output for details.");
    }
    return exitCode;
  }

  async delete(socket?: AppSocket): Promise<number> {
    if (!this.isManagedByProxima) {
      const docker = new Docker();
      const containers = await this.getProjectContainers();
      for (const info of containers) {
        const c = docker.getContainer(info.Id);
        if (info.State === "running") {
          await c.stop();
        }
        await c.remove();
      }
      const networks = await this.getProjectNetworks();
      for (const net of networks) {
        await docker.getNetwork(net.Id).remove();
      }
      return 0;
    }
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("down", "--remove-orphans"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to delete. Check terminal output for details.");
    }
    // Remove stack directory
    await fsAsync.rm(this.path, { recursive: true, force: true });
    return exitCode;
  }

  // ----- status queries --------------------------------------------------

  async ps(): Promise<ContainerInfo[]> {
    if (!this.isManagedByProxima) {
      try {
        const docker = new Docker();
        const infos = await this.getProjectContainers();
        const result: ContainerInfo[] = [];
        for (const info of infos) {
          try {
            const inspected = await docker.getContainer(info.Id).inspect();
            const rawMounts = (inspected.Mounts ?? []) as Array<{
              Type?: string;
              Source?: string;
              Destination?: string;
              Mode?: string;
              RW?: boolean;
            }>;
            const mounts: MountInfo[] = rawMounts.map((m) => ({
              type: m.Type ?? "bind",
              source: m.Source ?? "",
              destination: m.Destination ?? "",
              mode: m.Mode ?? "",
              rw: m.RW ?? true,
            }));
            const name = (info.Names?.[0] ?? "").replace(/^\//, "");
            const service =
              (info.Labels?.["com.docker.compose.service"] as string | undefined) ?? name;
            const ports = (info.Ports ?? [])
              .filter((p) => p.PublicPort)
              .map((p) => ({
                hostPort: p.PublicPort!,
                containerPort: p.PrivatePort,
                protocol: p.Type ?? "tcp",
              }));
            const networks = Object.entries(inspected.NetworkSettings?.Networks ?? {}).map(
              ([netName, net]) => ({
                name: netName,
                ipAddress: (net as { IPAddress?: string }).IPAddress ?? "",
                gateway: (net as { Gateway?: string }).Gateway ?? "",
              }),
            );
            result.push({
              name,
              service,
              state: info.State,
              status: info.Status,
              image: info.Image ?? "",
              ports,
              networks,
              mounts,
            });
          } catch {
            // container may have stopped between list and inspect
          }
        }
        return result;
      } catch {
        return [];
      }
    }

    try {
      const { stdout } = await execFileAsync(
        DOCKER_BIN,
        [...this.getComposeOptions("ps", "--format", "json")],
        { cwd: this.path },
      );
      if (!stdout) return [];
      const containers = parseComposePs(stdout);

      // Enrich with mount info from dockerode inspect
      const docker = new Docker({ socketPath: "/var/run/docker.sock" });
      for (const c of containers) {
        if (!c.name) continue;
        try {
          const info = await docker.getContainer(c.name).inspect();
          const rawMounts = (info.Mounts ?? []) as Array<{
            Type?: string;
            Source?: string;
            Destination?: string;
            Mode?: string;
            RW?: boolean;
          }>;
          c.mounts = rawMounts.map((m) => ({
            type: m.Type ?? "bind",
            source: m.Source ?? "",
            destination: m.Destination ?? "",
            mode: m.Mode ?? "",
            rw: m.RW ?? true,
          }));
        } catch {
          // container may have stopped between ps and inspect
        }
      }

      return containers;
    } catch {
      return [];
    }
  }

  async updateStatus(): Promise<void> {
    const statusList = await Stack.getStatusList();
    const status = statusList.get(this.name);
    this._status = status ?? "unknown";
  }

  async getServiceStatusList(): Promise<
    Map<string, { state: string; ports: string[] }>
  > {
    const result = new Map<string, { state: string; ports: string[] }>();

    if (!this.isManagedByProxima) {
      try {
        const infos = await this.getProjectContainers();
        for (const info of infos) {
          const service =
            (info.Labels?.["com.docker.compose.service"] as string | undefined) ??
            (info.Names?.[0] ?? "").replace(/^\//, "");
          const ports = (info.Ports ?? [])
            .filter((p) => p.PublicPort)
            .map((p) => `${p.IP ?? ""}:${p.PublicPort}->${p.PrivatePort}/${p.Type}`);
          result.set(service, { state: info.State, ports });
        }
      } catch (e) {
        logger.error("Stack.getServiceStatusList", e);
      }
      return result;
    }

    try {
      const { stdout } = await execFileAsync(
        DOCKER_BIN,
        [...this.getComposeOptions("ps", "--format", "json")],
        { cwd: this.path },
      );
      if (!stdout) return result;

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as {
            Service?: string;
            State?: string;
            Health?: string;
            Ports?: string;
          };
          const ports = (obj.Ports ?? "")
            .split(/,\s*/)
            .filter((s: string) => s.includes("->"));
          const state =
            obj.Health && obj.Health !== "" ? obj.Health : (obj.State ?? "");
          result.set(obj.Service ?? "", { state, ports });
        } catch {
          // skip malformed lines
        }
      }
    } catch (e) {
      logger.error("Stack.getServiceStatusList", e);
    }
    return result;
  }

  // ----- terminal helpers ------------------------------------------------

  async joinCombinedTerminal(socket: AppSocket): Promise<void> {
    const terminalName = getCombinedTerminalName(this.name);
    const terminal = Terminal.getOrCreateTerminal(
      terminalName,
      DOCKER_BIN,
      this.getComposeOptions("logs", "-f", "--tail", "100"),
      this.path,
    );
    terminal.enableKeepAlive = true;
    terminal.rows = COMBINED_TERMINAL_ROWS;
    terminal.cols = COMBINED_TERMINAL_COLS;
    terminal.join(socket);
    terminal.start();
  }

  async leaveCombinedTerminal(socket: AppSocket): Promise<void> {
    const terminalName = getCombinedTerminalName(this.name);
    Terminal.getTerminal(terminalName)?.leave(socket);
  }

  async joinContainerTerminal(
    socket: AppSocket,
    serviceName: string,
    shell: string = "sh",
    index: number = 0,
  ): Promise<void> {
    const terminalName = getContainerExecTerminalName(
      this.name,
      serviceName,
      index,
    );
    let terminal = Terminal.getTerminal(terminalName) as InteractiveTerminal | undefined;

    if (!terminal) {
      terminal = new InteractiveTerminal(
        terminalName,
        DOCKER_BIN,
        this.getComposeOptions("exec", serviceName, shell),
        this.path,
      );
      terminal.rows = TERMINAL_ROWS;
      logger.debug("Stack.joinContainerTerminal", `Created terminal ${terminalName}`);
    }

    terminal.join(socket);
    terminal.start();
  }

  // ----- serialisation ---------------------------------------------------

  async toJSON(): Promise<object> {
    return {
      ...this.toSimpleJSON(),
      composeYAML: this.composeYAML,
      composeENV: this.composeENV,
      dockerfiles: this.dockerfiles,
    };
  }

  toSimpleJSON(): object {
    return {
      name: this.name,
      status: this._status,
      isManagedByProxima: this.isManagedByProxima,
      composeFileName: this._composeFileName,
    };
  }

  // ----- static list management ------------------------------------------

  static async composeFileExists(
    stacksDir: string,
    dirName: string,
  ): Promise<boolean> {
    for (const filename of ACCEPTED_COMPOSE_FILENAMES) {
      if (await fileExists(path.join(stacksDir, dirName, filename))) {
        return true;
      }
    }
    return false;
  }

  static async getStackList(
    stacksDir: string,
    useCacheForManaged: boolean = false,
  ): Promise<Map<string, Stack>> {
    let stackList: Map<string, Stack>;

    if (useCacheForManaged && Stack.managedStackList.size > 0) {
      stackList = Stack.managedStackList;
    } else {
      stackList = new Map<string, Stack>();

      let entries: string[] = [];
      try {
        entries = await fsAsync.readdir(stacksDir);
      } catch {
        // stacks dir may not exist yet
      }

      for (const entry of entries) {
        try {
          const stat = await fsAsync.stat(path.join(stacksDir, entry));
          if (!stat.isDirectory()) continue;
          if (!await Stack.composeFileExists(stacksDir, entry)) continue;

          const stack = await Stack.getStack(stacksDir, entry);
          stack._status = "created";
          stackList.set(entry, stack);
        } catch (e) {
          if (e instanceof Error) {
            logger.warn("Stack.getStackList", `Failed to load stack ${entry}: ${e.message}`);
          }
        }
      }

      Stack.managedStackList = new Map(stackList);
    }

    // Overlay live status from docker compose ls
    try {
      const { stdout } = await execFileAsync(DOCKER_BIN, [
        "compose",
        "ls",
        "--all",
        "--format",
        "json",
      ]);

      if (stdout) {
        const composeList = JSON.parse(stdout) as Array<{
          Name: string;
          Status: string;
          ConfigFiles?: string;
        }>;

        for (const entry of composeList) {
          let stack = stackList.get(entry.Name);
          if (!stack) {
            stack = new Stack(stacksDir, entry.Name, undefined, undefined, true);
            stackList.set(entry.Name, stack);
          }
          stack._status = statusToEnum(entry.Status);
          if (entry.ConfigFiles) {
            stack._configFilePath = entry.ConfigFiles;
          }
        }
      }
    } catch (e) {
      logger.warn("Stack.getStackList", `docker compose ls failed: ${e instanceof Error ? e.message : e}`);
    }

    return stackList;
  }

  static async getStatusList(): Promise<Map<string, StackStatus>> {
    const statusList = new Map<string, StackStatus>();
    try {
      const { stdout } = await execFileAsync(DOCKER_BIN, [
        "compose",
        "ls",
        "--all",
        "--format",
        "json",
      ]);
      if (!stdout) return statusList;

      const list = JSON.parse(stdout) as Array<{ Name: string; Status: string }>;
      for (const entry of list) {
        statusList.set(entry.Name, statusToEnum(entry.Status));
      }
    } catch {
      // docker may not be available
    }
    return statusList;
  }

  static async getStack(
    stacksDir: string,
    stackName: string,
    skipFSOperations: boolean = false,
  ): Promise<Stack> {
    const dir = path.join(stacksDir, stackName);

    if (!skipFSOperations) {
      if (!await fileExists(dir) || !(await fsAsync.stat(dir)).isDirectory()) {
        // Try to find it via docker compose ls
        const list = await Stack.getStackList(stacksDir, true);
        const found = list.get(stackName);
        if (found) return found;
        throw new ValidationError(`Stack "${stackName}" not found`);
      }
    }

    const stack = new Stack(stacksDir, stackName, undefined, undefined, skipFSOperations);
    stack._status = "unknown";
    stack._configFilePath = path.resolve(dir);
    return stack;
  }
}
