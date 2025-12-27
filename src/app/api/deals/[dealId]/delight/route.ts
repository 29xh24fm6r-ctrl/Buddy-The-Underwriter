// src/app/api/deals/[dealId]/delight/route.ts
// Record borrower delight moments (milestones, achievements)

import { writeAiEvent } from "@/lib/aiEvents";
import { computeReadiness } from "@/lib/readiness";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const { message, milestone } = await req.json();

  // Fetch current events to compute context
  const supabase = getSupabaseServerClient();
  const { data: events } = await supabase
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  const readiness = computeReadiness(events ?? []);

  // Write delight moment
  await writeAiEvent({
    deal_id: dealId,
    kind: "borrower.delight.moment",
    scope: "ux",
    action: "celebrate",
    input_json: { milestone },
    output_json: {
      message: message ?? `You're ${Math.round(readiness.score * 100)}% to E-Tran ready 🎉`,
      readiness_score: readiness.score,
      milestone
    },
    confidence: 1.0
  });

  return Response.json({ ok: true, message });
}
