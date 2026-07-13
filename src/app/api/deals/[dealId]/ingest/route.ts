import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { fetchQBOSummary } from "@/lib/integrations/qbo";
import { fetchIRSSummary } from "@/lib/integrations/irs";

// Real bank-transaction data comes from src/lib/integrations/plaid/ (ARC-00
// SPEC S2) via the borrower-facing Link flow — see
// /api/borrower/plaid/{link-token,exchange,webhook}. This legacy demo
// ingest endpoint no longer includes a Plaid summary; the 3-line stub it
// used to call (hardcoded fake balances) was removed.
export async function POST(
  _: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  const [qbo, irs] = await Promise.all([
    fetchQBOSummary(),
    fetchIRSSummary()
  ]);

  await writeAiEvent({
    deal_id: dealId,
    kind: "facts.ingested",
    scope: "financials",
    action: "summarize",
    output_json: { qbo, irs },
    confidence: 0.95
  });

  return NextResponse.json({ ok: true });
}
