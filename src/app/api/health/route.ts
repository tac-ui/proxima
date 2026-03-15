import { type NextRequest } from "next/server";
import { ok } from "../_lib/auth";

export async function GET(_req: NextRequest) {
  return ok({ status: "ok", timestamp: new Date().toISOString() });
}
