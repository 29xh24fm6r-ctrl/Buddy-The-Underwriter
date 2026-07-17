import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/ai-events";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export async function POST(
  _req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

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
