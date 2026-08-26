import { NextResponse } from "next/server";
import { replayEvents } from "@/lib/replay";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export async function GET(
  req: Request,
  context: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await context.params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const until = new URL(req.url).searchParams.get("until");
  const { data, error } = await access.sb
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId);

  if (error) {
    console.error("[deal replay] event lookup failed", { dealId, code: error.code });
    return NextResponse.json(
      { ok: false, error: "replay_fetch_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    replay: replayEvents(data ?? [], until ? new Date(until) : undefined),
  });
}
