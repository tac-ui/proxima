import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
import { sendTestNotification } from "@server/services/notification";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDb();
    requireManager(req);
    const { id } = await params;
    const channelId = parseInt(id, 10);
    if (isNaN(channelId)) throw new Error("Invalid channel id");

    await sendTestNotification(channelId);
    return ok({ sent: true });
  } catch (err) {
    return errorResponse(err);
  }
}
