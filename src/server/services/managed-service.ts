import { getDb } from "../db/index";
import { managedServices } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { NetworkDiscovery } from "./network-discovery";
import type { ManagedServiceType } from "@/types";

export function containerIdentifier(stackName: string, serviceName: string): string {
  return `${stackName}/${serviceName}`;
}

export function processIdentifier(name: string, port: number): string {
  return `${name}:${port}`;
}

export function listManaged() {
  const db = getDb();
  return db.select().from(managedServices).all();
}

export function addManaged(type: ManagedServiceType, identifier: string, autoManaged = false) {
  const db = getDb();
  // INSERT OR IGNORE for UNIQUE constraint
  return db
    .insert(managedServices)
    .values({ type, identifier, autoManaged })
    .onConflictDoNothing()
    .run();
}

export function removeManaged(id: number) {
  const db = getDb();
  return db.delete(managedServices).where(eq(managedServices.id, id)).run();
}

export function findManaged(type: ManagedServiceType, identifier: string) {
  const db = getDb();
  return db
    .select()
    .from(managedServices)
    .where(and(eq(managedServices.type, type), eq(managedServices.identifier, identifier)))
    .get();
}

export async function syncAutoManaged() {
  try {
    const discovery = new NetworkDiscovery();
    const services = await discovery.discoverServices();

    for (const svc of services) {
      if (!svc.stackName || !svc.serviceName) continue;
      const id = containerIdentifier(svc.stackName, svc.serviceName);
      const db = getDb();
      // Upsert: insert if not exists, update autoManaged if exists
      const existing = db
        .select()
        .from(managedServices)
        .where(and(eq(managedServices.type, "container"), eq(managedServices.identifier, id)))
        .get();
      if (!existing) {
        db.insert(managedServices)
          .values({ type: "container", identifier: id, autoManaged: true })
          .onConflictDoNothing()
          .run();
      }
    }

    logger.info("managed-service", `Synced auto-managed services (${services.length} containers scanned)`);
  } catch (err) {
    logger.warn("managed-service", `Failed to sync auto-managed services: ${err}`);
  }
}
