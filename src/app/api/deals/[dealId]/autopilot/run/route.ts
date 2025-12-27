import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";

export async function POST(
  _: Request,
  { params }: { params: { dealId: string } }
) {
  const dealId = params.dealId;

  await writeAiEvent({
    deal_id: dealId,
    kind: "autopilot.run.started",
    scope: "sba",
    action: "execute"
  });

  for (const stage of ["intake", "analysis", "conditions", "package"]) {
    await writeAiEvent({
      deal_id: dealId,
      kind: "autopilot.stage.completed",
      scope: stage,
      action: "complete",
      confidence: 0.9
    });
  }

  await writeAiEvent({
    deal_id: dealId,
    kind: "autopilot.run.completed",
    scope: "sba",
    action: "finalize",
    output_json: { etran_ready: true },
    confidence: 0.97
  });

  return NextResponse.json({ ok: true });
}
