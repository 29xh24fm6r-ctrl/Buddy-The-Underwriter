import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeRiskFacts } from "@/lib/risk/normalizeRiskFacts";

/**
 * POST /api/deals/[dealId]/risk-facts/generate
 * 
 * Generate normalized risk facts from snapshot context
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  try {
    const { dealId } = params;
    const body = await req.json();
    const { snapshotId } = body;

    if (!snapshotId) {
      return NextResponse.json(
        { error: "snapshotId is required" },
        { status: 400 }
      );
    }

    // Load snapshot
    const supabase = supabaseAdmin();
    const { data: snapshot, error: snapshotError } = await supabase
      .from("deal_context_snapshots")
      .select("*")
      .eq("id", snapshotId)
      .eq("deal_id", dealId)
      .single();

    if (snapshotError || !snapshot) {
      return NextResponse.json(
        { error: "Snapshot not found" },
        { status: 404 }
      );
    }

    // Normalize to risk facts
    const { facts, facts_hash, confidence } = normalizeRiskFacts(snapshot.context);

    // Check if identical facts already exist (optional deduplication)
    const { data: existing } = await supabase
      .from("risk_facts")
      .select("id")
      .eq("snapshot_id", snapshotId)
      .eq("facts_hash", facts_hash)
      .maybeSingle();

    if (existing) {
      // Return existing instead of creating duplicate
      const { data: existingFull } = await supabase
        .from("risk_facts")
        .select("*")
        .eq("id", existing.id)
        .single();

      return NextResponse.json({
        risk_facts: existingFull,
        cached: true,
      });
    }

    // Insert new risk facts
    const { data: riskFacts, error: insertError } = await supabase
      .from("risk_facts")
      .insert({
        deal_id: dealId,
        snapshot_id: snapshotId,
        facts,
        facts_hash,
        confidence,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert risk facts:", insertError);
      return NextResponse.json(
        { error: "Failed to create risk facts" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      risk_facts: riskFacts,
      cached: false,
    });
  } catch (error) {
    console.error("Error generating risk facts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
