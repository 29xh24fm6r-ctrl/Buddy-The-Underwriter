import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { generateOffers } from "@/lib/offers/offerEngine";

export async function POST(
  _: Request,
  { params }: { params: { dealId: string } }
) {
  const offers = generateOffers({});

  await writeAiEvent({
    deal_id: params.dealId,
    kind: "offers.generated",
    scope: "credit",
    action: "compare",
    output_json: { offers },
    confidence: 0.85
  });

  return NextResponse.json({ ok: true });
}
