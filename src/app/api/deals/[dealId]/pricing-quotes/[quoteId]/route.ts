import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * PATCH /api/deals/[dealId]/pricing-quotes/[quoteId]
 * 
 * Update pricing quote (edit quote fields or change status)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string; quoteId: string } }
) {
  try {
    const { dealId, quoteId } = params;
    const body = await req.json();
    const { quote, assumptions, status } = body;

    // Build update payload
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (quote !== undefined) updates.quote = quote;
    if (assumptions !== undefined) updates.assumptions = assumptions;
    if (status !== undefined) updates.status = status;

    // Update quote
    const supabase = supabaseAdmin();
    const { data: updated, error: updateError } = await supabase
      .from("pricing_quotes")
      .update(updates)
      .eq("id", quoteId)
      .eq("deal_id", dealId)
      .select()
      .single();

    if (updateError) {
      console.error("Failed to update pricing quote:", updateError);
      return NextResponse.json(
        { error: "Failed to update pricing quote" },
        { status: 500 }
      );
    }

    return NextResponse.json({ pricing_quote: updated });
  } catch (error) {
    console.error("Error updating pricing quote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/deals/[dealId]/pricing-quotes/[quoteId]
 * 
 * Get single pricing quote
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string; quoteId: string } }
) {
  try {
    const { dealId, quoteId } = params;

    const supabase = supabaseAdmin();
    const { data: quote, error } = await supabase
      .from("pricing_quotes")
      .select("*")
      .eq("id", quoteId)
      .eq("deal_id", dealId)
      .single();

    if (error || !quote) {
      return NextResponse.json(
        { error: "Pricing quote not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ pricing_quote: quote });
  } catch (error) {
    console.error("Error fetching pricing quote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
