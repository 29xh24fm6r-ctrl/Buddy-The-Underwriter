import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { simulateExaminerReview } from "@/lib/examiner/examinerSimulator";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const { data: events, error } = await access.sb
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId);

  if (error) {
    console.error("[examiner simulation] event lookup failed", {
      dealId,
      code: error.code,
    });
    return NextResponse.json(
      { ok: false, error: "examiner_context_failed" },
      { status: 500 },
    );
  }

  const result = simulateExaminerReview(events ?? []);

  await writeAiEvent({
    deal_id: dealId,
    kind: "examiner.simulation.completed",
    scope: "sba",
    action: "review",
    output_json: result,
    confidence: 0.9,
  });

  return NextResponse.json({ ok: true });
}
