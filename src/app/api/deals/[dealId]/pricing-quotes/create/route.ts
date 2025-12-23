import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generatePricingQuote } from "@/lib/pricing/generatePricingQuote";

/**
 * POST /api/deals/[dealId]/pricing-quotes/create
 * 
 * Generate pricing quote from risk facts
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  try {
    const { dealId } = params;
    const body = await req.json();
    const { snapshotId, riskFactsId } = body;

    if (!snapshotId || !riskFactsId) {
      return NextResponse.json(
        { error: "snapshotId and riskFactsId are required" },
        { status: 400 }
      );
    }

    // Load risk facts
    const supabase = supabaseAdmin();
    const { data: riskFacts, error: factsError } = await supabase
      .from("risk_facts")
      .select("*")
      .eq("id", riskFactsId)
      .eq("deal_id", dealId)
      .single();

    if (factsError || !riskFacts) {
      return NextResponse.json(
        { error: "Risk facts not found" },
        { status: 404 }
      );
    }

    // Generate quote
    const { quote, assumptions } = generatePricingQuote(riskFacts.facts);

    // Insert pricing quote
    const { data: pricingQuote, error: insertError } = await supabase
      .from("pricing_quotes")
      .insert({
        deal_id: dealId,
        snapshot_id: snapshotId,
        risk_facts_id: riskFactsId,
        status: "draft",
        quote,
        assumptions,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert pricing quote:", insertError);
      return NextResponse.json(
        { error: "Failed to create pricing quote" },
        { status: 500 }
      );
    }

    return NextResponse.json({ pricing_quote: pricingQuote });
  } catch (error) {
    console.error("Error creating pricing quote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
