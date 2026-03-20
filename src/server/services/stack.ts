import fs from "node:fs";
import { promises as fsAsync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
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
    this.stacksDir = stacksDir;
    this.name = name;
    this._composeYAML = composeYAML;
    this._composeENV = composeENV;
    this._dockerfiles = dockerfiles;

    if (!skipFSOperations) {
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
        if (content.trim() !== "") {
          await fsAsync.writeFile(path.join(dir, filename), content, "utf-8");
        }
      }
    }
  }

  // ----- docker operations -----------------------------------------------

  async deploy(socket?: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
      this.getComposeOptions("up", "-d", "--remove-orphans"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to deploy. Check terminal output for details.");
    }
    return exitCode;
  }

  async start(socket?: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
      this.getComposeOptions("up", "-d", "--remove-orphans"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to start. Check terminal output for details.");
    }
    return exitCode;
  }

  async stop(socket?: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
      this.getComposeOptions("stop"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to stop. Check terminal output for details.");
    }
    return exitCode;
  }

  async restart(socket?: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
      this.getComposeOptions("restart"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to restart. Check terminal output for details.");
    }
    return exitCode;
  }

  async down(socket: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
      this.getComposeOptions("down"),
      this.path,
    );
    if (exitCode !== 0) {
      throw new Error("Failed to bring down. Check terminal output for details.");
    }
    return exitCode;
  }

  async delete(socket?: AppSocket): Promise<number> {
    const terminalName = getComposeTerminalName(this.name);
    const exitCode = await Terminal.exec(
      socket,
      terminalName,
      "docker",
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
    try {
      const { stdout } = await execFileAsync(
        "docker",
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
    try {
      const { stdout } = await execFileAsync(
        "docker",
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
      "docker",
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
        "docker",
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
      const { stdout } = await execFileAsync("docker", [
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
      const { stdout } = await execFileAsync("docker", [
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
