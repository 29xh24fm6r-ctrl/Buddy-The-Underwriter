import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentity } from "@/lib/brokerage/lenderAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/lender/deals/[dealId]
 *
 * Lender-Facing Data (Read-Only)
 * - Requires an authenticated lender (a bank with an active marketplace
 *   agreement). Previously unauthenticated — it returned borrower deal data
 *   (name, amount, documents, timeline) to any caller; the honest security gate
 *   (audit C3) surfaced it.
 * - Lenders are cross-tenant by design (see lenderAuth.ts), but per that same
 *   module's documented invariant, access to any *specific* deal still
 *   requires an explicit, unrevoked marketplace_package_access grant for
 *   (dealId, lenderBankId) -- "is a lender at all" is not sufficient. This
 *   route previously skipped that check (unlike its sibling
 *   /api/lender/marketplace/package/[accessId]), letting any lender pull
 *   full deal detail for any deal, including competitors' deals, by
 *   guessing/enumerating deal IDs.
 * - 404 (not 403) on a missing/revoked grant, matching the sibling route's
 *   no-existence-leak convention.
 * - No mutations allowed.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const lender = await resolveLenderIdentity();
  if (!lender) {
    return NextResponse.json({ ok: false, error: "not_a_lender" }, { status: 403 });
  }

  const { dealId } = await context.params;
  const sb = supabaseAdmin();

  const { data: grant } = await sb
    .from("marketplace_package_access")
    .select("id")
    .eq("deal_id", dealId)
    .eq("lender_bank_id", lender.lenderBankId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (!grant) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }

  try {
    // Fetch deal
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, borrower_name, amount, ready_at, ready_reason, submitted_at, created_at")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Fetch checklist summary
    const { data: checklistItems } = await sb
      .from("deal_checklist_items")
      .select("required, received_at")
      .eq("deal_id", dealId);

    const required = checklistItems?.filter((i) => i.required).length || 0;
    const satisfied = checklistItems?.filter((i) => i.required && i.received_at).length || 0;

    // Fetch documents
    const { data: documents } = await sb
      .from("deal_documents")
      .select("id, original_filename, uploaded_at, finalized_at")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false });

    // Fetch latest ledger event
    const { data: ledgerEvents } = await sb
      .from("deal_pipeline_ledger")
      .select("stage, status, payload, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(5);

    return NextResponse.json({
      ok: true,
      deal: {
        id: deal.id,
        borrower_name: deal.borrower_name,
        amount: deal.amount,
        ready_at: deal.ready_at,
        ready_reason: deal.ready_reason,
        submitted_at: deal.submitted_at,
        created_at: deal.created_at,
      },
      checklist_summary: {
        required,
        satisfied,
      },
      documents: documents || [],
      timeline: ledgerEvents || [],
    });
  } catch (err: any) {
    console.error("[lender] Error fetching deal", { dealId, error: err.message });
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
