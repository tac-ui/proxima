import * as pty from "node-pty";
import { logger } from "../lib/logger";
import { sanitizeEnvForPty } from "../lib/validators";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TERMINAL_ROWS = 30;
const TERMINAL_COLS = 80;
const PROGRESS_TERMINAL_ROWS = 10;
const COMBINED_TERMINAL_ROWS = 50;
const COMBINED_TERMINAL_COLS = 200;
const KICKOUT_INTERVAL_MS = 60_000;
const KEEPALIVE_CHECK_MS = 60_000;

/** Minimal socket-like interface used by Terminal for client communication. */
export interface AppSocket {
  id: string;
  connected: boolean;
  emit(event: string, ...args: unknown[]): unknown;
}

// ---------------------------------------------------------------------------
// LimitQueue – fixed-size circular buffer that drops oldest items on overflow
// ---------------------------------------------------------------------------
export class LimitQueue<T> {
  private items: T[] = [];
  private readonly limit: number;

  constructor(limit: number = 100) {
    this.limit = limit;
  }

  push(value: T): void {
    this.items.push(value);
    if (this.items.length > this.limit) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  get length(): number {
    return this.items.length;
  }

  join(separator: string = ""): string {
    return this.items.join(separator);
  }
}

// Use globalThis to share terminal map across Next.js API routes and custom server
const globalForTerminals = globalThis as unknown as { __terminalMap?: Map<string, Terminal> };
if (!globalForTerminals.__terminalMap) {
  globalForTerminals.__terminalMap = new Map();
}

// ---------------------------------------------------------------------------
// Terminal – non-interactive PTY (progress output, docker compose logs, etc.)
// ---------------------------------------------------------------------------
export class Terminal {
  protected static get terminalMap(): Map<string, Terminal> {
    return globalForTerminals.__terminalMap!;
  }

  protected _ptyProcess?: pty.IPty;
  protected buffer: LimitQueue<string> = new LimitQueue(100);
  protected _name: string;

  protected file: string;
  protected args: string | string[];
  protected cwd: string;
  protected callback?: (exitCode: number) => void;

  protected _rows: number = TERMINAL_ROWS;
  protected _cols: number = TERMINAL_COLS;

  public enableKeepAlive: boolean = false;
  protected keepAliveInterval?: NodeJS.Timeout;
  protected kickDisconnectedClientsInterval?: NodeJS.Timeout;

  protected socketList: Record<string, AppSocket> = {};

  constructor(
    name: string,
    file: string,
    args: string | string[],
    cwd: string,
  ) {
    this._name = name;
    this.file = file;
    this.args = args;
    this.cwd = cwd;
    Terminal.terminalMap.set(this._name, this);
  }

  // ----- rows / cols with live resize ------------------------------------

  get rows(): number {
    return this._rows;
  }

  set rows(rows: number) {
    this._rows = rows;
    try {
      this._ptyProcess?.resize(this._cols, rows);
    } catch (e) {
      if (e instanceof Error) {
        logger.debug("Terminal", `Failed to resize rows: ${e.message}`);
      }
    }
  }

  get cols(): number {
    return this._cols;
  }

  set cols(cols: number) {
    this._cols = cols;
    try {
      this._ptyProcess?.resize(cols, this._rows);
    } catch (e) {
      if (e instanceof Error) {
        logger.debug("Terminal", `Failed to resize cols: ${e.message}`);
      }
    }
  }

  // ----- lifecycle -------------------------------------------------------

  public start(): void {
    if (this._ptyProcess) {
      // Already running – idempotent
      return;
    }

    // Kick disconnected clients periodically
    this.kickDisconnectedClientsInterval = setInterval(() => {
      for (const socketId of Object.keys(this.socketList)) {
        const socket = this.socketList[socketId];
        if (!socket.connected) {
          logger.debug("Terminal", `Kicking disconnected client ${socketId} from terminal ${this._name}`);
          this.leave(socket);
        }
      }
    }, KICKOUT_INTERVAL_MS);

    if (this.enableKeepAlive) {
      this.keepAliveInterval = setInterval(() => {
        const numClients = Object.keys(this.socketList).length;
        if (numClients === 0) {
          logger.debug("Terminal", `Terminal ${this._name} has no clients, closing`);
          this.close();
        } else {
          logger.debug("Terminal", `Terminal ${this._name} has ${numClients} client(s)`);
        }
      }, KEEPALIVE_CHECK_MS);
    }

    try {
      const argsArray = Array.isArray(this.args) ? this.args : [this.args];
      this._ptyProcess = pty.spawn(this.file, argsArray, {
        name: "xterm-256color",
        cwd: this.cwd,
        cols: this._cols,
        rows: this._rows,
        env: sanitizeEnvForPty(),
      });

      this._ptyProcess.onData((data: string) => {
        this.buffer.push(data);
        for (const socket of Object.values(this.socketList)) {
          socket.emit("terminalWrite", this._name, data);
        }
      });

      this._ptyProcess.onExit(this.onExitHandler);
    } catch (error) {
      if (error instanceof Error) {
        clearInterval(this.keepAliveInterval);
        clearInterval(this.kickDisconnectedClientsInterval);
        logger.error("Terminal", `Failed to start terminal ${this._name}: ${error.message}`);
        // Extract numeric exit code from error message if possible
        const parts = error.message.split(" ");
        const exitCode = Number(parts[parts.length - 1]) || 1;
        this.onExitHandler({ exitCode });
      }
    }
  }

  protected onExitHandler = (res: { exitCode: number; signal?: number }): void => {
    console.log(`[Terminal] ${this._name} exited — code: ${res.exitCode}, signal: ${res.signal}`);

    for (const socket of Object.values(this.socketList)) {
      socket.emit("terminalExit", this._name, res.exitCode);
    }

    this.socketList = {};
    Terminal.terminalMap.delete(this._name);

    clearInterval(this.keepAliveInterval);
    clearInterval(this.kickDisconnectedClientsInterval);

    if (this.callback) {
      this.callback(res.exitCode);
    }
  };

  public onExit(callback: (exitCode: number) => void): void {
    this.callback = callback;
  }

  public close(): void {
    clearInterval(this.keepAliveInterval);
    // Send Ctrl+C to the terminal
    try {
      this._ptyProcess?.write("\x03");
    } catch {
      // ignore
    }
  }

  public kill(signal: string = "SIGTERM"): void {
    try {
      this._ptyProcess?.kill(signal);
    } catch {
      // ignore
    }
  }

  public removeFromMap(): void {
    Terminal.terminalMap.delete(this._name);
  }

  // ----- socket membership -----------------------------------------------

  public join(socket: AppSocket): void {
    this.socketList[socket.id] = socket;
  }

  public leave(socket: AppSocket): void {
    delete this.socketList[socket.id];
  }

  // ----- accessors -------------------------------------------------------

  public get name(): string {
    return this._name;
  }

  public get ptyProcess(): pty.IPty | undefined {
    return this._ptyProcess;
  }

  public getBuffer(): string {
    return this.buffer.join("");
  }

  // ----- static helpers --------------------------------------------------

  public static getTerminal(name: string): Terminal | undefined {
    return Terminal.terminalMap.get(name);
  }

  public static getOrCreateTerminal(
    name: string,
    file: string,
    args: string | string[],
    cwd: string,
  ): Terminal {
    const existing = Terminal.getTerminal(name);
    if (existing) {
      return existing;
    }
    return new Terminal(name, file, args, cwd);
  }

  /**
   * Create a terminal, attach socket if provided, run to completion, and
   * resolve with the exit code.
   */
  public static exec(
    socket: AppSocket | undefined,
    terminalName: string,
    file: string,
    args: string | string[],
    cwd: string,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      if (Terminal.terminalMap.has(terminalName)) {
        reject(new Error("Another operation is already running for this stack, please try again later."));
        return;
      }

      const terminal = new Terminal(terminalName, file, args, cwd);
      terminal.rows = PROGRESS_TERMINAL_ROWS;

      if (socket) {
        terminal.join(socket);
      }

      terminal.onExit((exitCode: number) => {
        resolve(exitCode);
      });

      terminal.start();
    });
  }

  public static getTerminalCount(): number {
    return Terminal.terminalMap.size;
  }

  /** Iterate all active terminals – used for socket disconnect cleanup. */
  public static getAllTerminals(): Terminal[] {
    return [...Terminal.terminalMap.values()];
  }
}

// ---------------------------------------------------------------------------
// InteractiveTerminal – used for `docker exec` shells
// ---------------------------------------------------------------------------
export class InteractiveTerminal extends Terminal {
  public write(input: string): void {
    this._ptyProcess?.write(input);
  }
}

// ---------------------------------------------------------------------------
// Terminal name helpers (mirrors Dockge's util-common helpers)
// ---------------------------------------------------------------------------
export function getComposeTerminalName(stackName: string): string {
  return `compose-${stackName}`;
}

export function getCombinedTerminalName(stackName: string): string {
  return `combined-${stackName}`;
}

export function getContainerExecTerminalName(
  stackName: string,
  serviceName: string,
  index: number = 0,
): string {
  return `exec-${stackName}-${serviceName}-${index}`;
}

export { COMBINED_TERMINAL_ROWS, COMBINED_TERMINAL_COLS, TERMINAL_ROWS, PROGRESS_TERMINAL_ROWS };
