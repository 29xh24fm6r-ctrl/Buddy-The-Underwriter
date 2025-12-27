import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { mapFactsToEtran } from "@/lib/etran/etranMapper";

export async function POST(
  _: Request,
  { params }: { params: { dealId: string } }
) {
  // facts would normally be derived from prior events
  const facts = {
    business_name: "Acme LLC",
    ein: "12-3456789",
    naics: "541330",
    requested_amount: 350000,
    use_of_proceeds: "Working capital"
  };

  const etranPayload = mapFactsToEtran(facts);

  await writeAiEvent({
    deal_id: params.dealId,
    kind: "etran.package.generated",
    scope: "sba",
    action: "populate",
    output_json: {
      payload: etranPayload,
      completeness: 0.92
    },
    confidence: 0.92
  });

  return NextResponse.json({ ok: true });
}
