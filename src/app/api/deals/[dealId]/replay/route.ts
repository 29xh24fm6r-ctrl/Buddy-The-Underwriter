import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { replayEvents } from "@/lib/replay";

export async function GET(
  req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;
  const supabase = getSupabaseServerClient();
  const until = new URL(req.url).searchParams.get("until");

  const { data } = await supabase
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId);

  return NextResponse.json({
    replay: replayEvents(data ?? [], until ? new Date(until) : undefined)
  });
}
