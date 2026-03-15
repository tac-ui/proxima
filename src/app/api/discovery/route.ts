import { type NextRequest } from "next/server";
import { requireAuth, errorResponse, ok } from "../_lib/auth";
import { ensureDb } from "../_lib/db";
import { broadcast } from "../_lib/event-bus";
import { NetworkDiscovery } from "@server/services/network-discovery";
import { listManaged, containerIdentifier } from "@server/services/managed-service";
import type { DiscoveredServiceWithManaged } from "@/types";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const discovery = new NetworkDiscovery();
    const services = await discovery.discoverServices();
    broadcast({ type: "discoveredServices", data: services });

    // Cross-reference with managed_services table
    const managed = listManaged();
    const managedMap = new Map(
      managed
        .filter((m) => m.type === "container")
        .map((m) => [m.identifier, m.id])
    );

    const result: DiscoveredServiceWithManaged[] = services.map((svc) => {
      const id = containerIdentifier(svc.stackName, svc.serviceName);
      const managedId = managedMap.get(id);
      return { ...svc, managed: managedId !== undefined, managedId };
    });

    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
