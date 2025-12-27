import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { simulateExaminerReview } from "@/lib/examiner/examinerSimulator";

export async function POST(
  _: Request,
  { params }: { params: { dealId: string } }
) {
  const supabase = getSupabaseServerClient();

  const { data: events } = await supabase
    .from("ai_events")
    .select("*")
    .eq("deal_id", params.dealId);

  const result = simulateExaminerReview(events ?? []);

  await writeAiEvent({
    deal_id: params.dealId,
    kind: "examiner.simulation.completed",
    scope: "sba",
    action: "review",
    output_json: result,
    confidence: 0.9
  });

  return NextResponse.json({ ok: true });
}
