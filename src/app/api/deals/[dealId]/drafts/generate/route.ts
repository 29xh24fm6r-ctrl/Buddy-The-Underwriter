import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUnderwriterOnDeal } from "@/lib/deals/participants";
import { generateDraftRequests, deduplicateDrafts } from "@/lib/borrower/generateDraftRequests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/drafts/generate
 * 
 * Auto-generate draft borrower requests from missing CTC conditions
 * 
 * Rules (deterministic):
 * 1. Read critical/high outstanding conditions
 * 2. Match to document type patterns
 * 3. Generate draft email with templates
 * 4. Insert into draft_borrower_requests (pending_approval)
 * 5. Underwriter reviews before sending
 * 
 * Returns: { ok: true, drafts_created: number, drafts: [...] }
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const supabase = supabaseAdmin();

    // Enforce underwriter access
    await requireUnderwriterOnDeal(dealId);

    // 1. Get deal info
    const { data: deal, error: dealErr } = await (supabase as any)
      .from("deals")
      .select("borrower_name, deal_name")
      .eq("id", dealId)
      .single();

    if (dealErr) throw dealErr;
    if (!deal) throw new Error("Deal not found");

    // 2. Get outstanding critical/high conditions
    const { data: conditions, error: condErr } = await (supabase as any)
      .from("conditions_to_close")
      .select("*")
      .eq("deal_id", dealId)
      .eq("outstanding", true)
      .in("severity", ["CRITICAL", "HIGH"])
      .order("severity", { ascending: true }); // CRITICAL first

    if (condErr) throw condErr;
    if (!conditions || conditions.length === 0) {
      return NextResponse.json({
        ok: true,
        drafts_created: 0,
        message: "No outstanding critical/high conditions to generate drafts for",
      });
    }

    // 3. Generate draft requests (deterministic templates)
    const drafts = generateDraftRequests(
      conditions,
      deal.deal_name || deal.borrower_name || "your business",
      deal.borrower_name || "Borrower"
    );

    // 4. Deduplicate by document type
    const uniqueDrafts = deduplicateDrafts(drafts);

    if (uniqueDrafts.length === 0) {
      return NextResponse.json({
        ok: true,
        drafts_created: 0,
        message: "No document types matched from conditions",
      });
    }

    // 5. Insert drafts (ON CONFLICT DO NOTHING via unique index)
    const { data: inserted, error: insertErr } = await (supabase as any)
      .from("draft_borrower_requests")
      .insert(
        uniqueDrafts.map((d) => ({
          deal_id: d.deal_id,
          condition_id: d.condition_id,
          missing_document_type: d.missing_document_type,
          draft_subject: d.draft_subject,
          draft_message: d.draft_message,
          evidence: d.evidence,
          status: "pending_approval",
        }))
      )
      .select();

    if (insertErr) {
      // Conflict = draft already exists (safe to ignore)
      if (insertErr.code === "23505") {
        return NextResponse.json({
          ok: true,
          drafts_created: 0,
          message: "Drafts already exist for these conditions",
        });
      }
      throw insertErr;
    }

    return NextResponse.json({
      ok: true,
      drafts_created: inserted?.length || 0,
      drafts: inserted,
    });
  } catch (err: any) {
    console.error("[POST /api/deals/:dealId/drafts/generate] Error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
