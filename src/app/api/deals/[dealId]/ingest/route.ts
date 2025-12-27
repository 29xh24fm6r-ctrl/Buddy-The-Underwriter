import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { fetchPlaidSummary } from "@/lib/integrations/plaid";
import { fetchQBOSummary } from "@/lib/integrations/qbo";
import { fetchIRSSummary } from "@/lib/integrations/irs";

export async function POST(
  _: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  const [plaid, qbo, irs] = await Promise.all([
    fetchPlaidSummary(),
    fetchQBOSummary(),
    fetchIRSSummary()
  ]);

  await writeAiEvent({
    deal_id: dealId,
    kind: "facts.ingested",
    scope: "financials",
    action: "summarize",
    output_json: { plaid, qbo, irs },
    confidence: 0.95
  });

  return NextResponse.json({ ok: true });
}
