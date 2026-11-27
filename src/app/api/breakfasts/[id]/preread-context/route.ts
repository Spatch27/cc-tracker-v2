import { getDb, isDatabaseConfigured } from "@/db";
import { errorResponse } from "@/lib/api-auth";
import { requireFounderSession } from "@/lib/auth";
import { buildBreakfastPrereadContext } from "@/lib/breakfasts/preread";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireFounderSession();
    if (!isDatabaseConfigured()) {
      return Response.json(
        { error: "Database is not configured" },
        { status: 503 },
      );
    }

    const { id } = await context.params;
    const db = getDb();
    const preread = await buildBreakfastPrereadContext(db, id);

    return Response.json({
      eventId: preread.eventId,
      markdown: preread.markdown,
      confirmedGuestsCount: preread.confirmedGuestsCount,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
