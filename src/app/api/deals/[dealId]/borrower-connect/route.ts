import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/ai-events";

export async function POST(
  _req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  await writeAiEvent({
    deal_id: dealId,
    kind: "borrower.connect.completed",
    scope: "financials",
    action: "complete",
    output_json: { sources: ["bank", "accounting"] },
    confidence: 0.9
  });

  return NextResponse.json({ ok: true });
}
