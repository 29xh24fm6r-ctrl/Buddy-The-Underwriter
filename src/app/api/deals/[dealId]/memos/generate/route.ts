import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateCreditMemoJson } from "@/lib/memo/generateCreditMemoJson";

/**
 * POST /api/deals/[dealId]/memos/generate
 * 
 * Generate credit memo JSON from snapshot + risk facts + optional pricing quote
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  try {
    const { dealId } = params;
    const body = await req.json();
    const { snapshotId, riskFactsId, pricingQuoteId } = body;

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

    // Load pricing quote (optional)
    let pricingQuote = null;
    if (pricingQuoteId) {
      const { data } = await supabase
        .from("pricing_quotes")
        .select("*")
        .eq("id", pricingQuoteId)
        .eq("deal_id", dealId)
        .maybeSingle();

      if (data) {
        pricingQuote = data.quote;
      }
    }

    // Generate memo JSON
    const memoContent = generateCreditMemoJson(
      snapshotId,
      riskFactsId,
      riskFacts.facts_hash,
      riskFacts.facts,
      pricingQuote,
      pricingQuoteId ?? null
    );

    // Insert into generated_documents
    const { data: generatedDoc, error: insertError } = await supabase
      .from("generated_documents")
      .insert({
        deal_id: dealId,
        snapshot_id: snapshotId,
        doc_type: "credit_memo",
        title: `Credit Memo - ${memoContent.header.borrower}`,
        source: {
          risk_facts_id: riskFactsId,
          pricing_quote_id: pricingQuoteId,
          snapshot_id: snapshotId,
          facts_hash: riskFacts.facts_hash,
        },
        content_json: memoContent,
        status: "draft",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert generated document:", insertError);
      return NextResponse.json(
        { error: "Failed to create memo" },
        { status: 500 }
      );
    }

    return NextResponse.json({ generated_document: generatedDoc });
  } catch (error) {
    console.error("Error generating memo:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
