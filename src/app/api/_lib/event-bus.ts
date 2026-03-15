import { EventEmitter } from "node:events";
import type { StackListItem, StackStatus, ProxyHost, DiscoveredService, GitCloneProgress } from "@/types";

export type SSEEvent =
  | { type: "stackList"; data: StackListItem[] }
  | { type: "stackStatus"; data: { name: string; status: StackStatus } }
  | { type: "proxyHostList"; data: ProxyHost[] }
  | { type: "discoveredServices"; data: DiscoveredService[] }
  | { type: "gitProgress"; data: { sessionId: string; progress: GitCloneProgress } };

// Use globalThis to survive Next.js hot reloads in dev
const globalForBus = globalThis as unknown as { __eventBus?: EventEmitter };

if (!globalForBus.__eventBus) {
  globalForBus.__eventBus = new EventEmitter();
  globalForBus.__eventBus.setMaxListeners(100);
}

export const eventBus: EventEmitter = globalForBus.__eventBus;

export function broadcast(event: SSEEvent): void {
  eventBus.emit("broadcast", event);
}
