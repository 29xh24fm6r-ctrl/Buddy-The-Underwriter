import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveLenderIdentityResult } from "@/lib/brokerage/lenderAuth";
import { DealIsolationError, assertNotTestDeal } from "@/lib/qaIdentity/isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function boundedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }
  return normalized;
}

/**
 * Lender-facing, read-only deal summary. An explicit unrevoked package grant
 * is required, and every supporting database read must complete before a
 * successful response can be emitted.
 */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const identity = await resolveLenderIdentityResult();
  if (!identity.ok) {
    if (identity.reason === "identity_state_unavailable") {
      return json({ ok: false, error: "lender_identity_unavailable" }, 503);
    }
    if (identity.reason === "ambiguous_lender_identity") {
      return json({ ok: false, error: "ambiguous_lender_identity" }, 409);
    }
    return json({ ok: false, error: "not_a_lender" }, 403);
  }

  const dealId = boundedId((await context.params).dealId);
  if (!dealId) return json({ ok: false, error: "invalid_deal" }, 400);

  const lender = identity.identity;
  const sb = supabaseAdmin();

  try {
    const { data: grant, error: grantError } = await sb
      .from("marketplace_package_access")
      .select("id")
      .eq("deal_id", dealId)
      .eq("lender_bank_id", lender.lenderBankId)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (grantError) return json({ ok: false, error: "package_access_unavailable" }, 503);
    if (!grant) return json({ ok: false, error: "deal_not_found" }, 404);

    try {
      await assertNotTestDeal(dealId, sb);
    } catch (error) {
      if (error instanceof DealIsolationError) {
        if (error.code === "test_application") {
          return json({ ok: false, error: "test_application_distribution_blocked" }, 403);
        }
        if (error.code === "deal_not_found") {
          return json({ ok: false, error: "deal_not_found" }, 404);
        }
      }
      return json({ ok: false, error: "deal_isolation_state_unavailable" }, 503);
    }

    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, borrower_name, amount, ready_at, ready_reason, submitted_at, created_at, is_test")
      .eq("id", dealId)
      .maybeSingle();
    if (dealError) return json({ ok: false, error: "deal_state_unavailable" }, 503);
    if (!deal) return json({ ok: false, error: "deal_not_found" }, 404);

    const [checklistResult, documentResult, ledgerResult] = await Promise.all([
      sb
        .from("deal_checklist_items")
        .select("required, received_at")
        .eq("deal_id", dealId),
      sb
        .from("deal_documents")
        .select("id, original_filename, uploaded_at, finalized_at")
        .eq("deal_id", dealId)
        .order("uploaded_at", { ascending: false }),
      sb
        .from("deal_pipeline_ledger")
        .select("stage, status, payload, created_at")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (checklistResult.error || !Array.isArray(checklistResult.data)) {
      return json({ ok: false, error: "checklist_state_unavailable" }, 503);
    }
    if (documentResult.error || !Array.isArray(documentResult.data)) {
      return json({ ok: false, error: "document_state_unavailable" }, 503);
    }
    if (ledgerResult.error || !Array.isArray(ledgerResult.data)) {
      return json({ ok: false, error: "timeline_state_unavailable" }, 503);
    }

    const required = checklistResult.data.filter((item) => item.required).length;
    const satisfied = checklistResult.data.filter(
      (item) => item.required && item.received_at,
    ).length;

    return json({
      ok: true,
      deal: {
        id: deal.id,
        borrower_name: deal.borrower_name,
        amount: deal.amount,
        ready_at: deal.ready_at,
        ready_reason: deal.ready_reason,
        submitted_at: deal.submitted_at,
        created_at: deal.created_at,
        is_test: deal.is_test === true,
      },
      checklist_summary: { required, satisfied },
      documents: documentResult.data,
      timeline: ledgerResult.data,
    });
  } catch {
    console.error("[lender/deal] read boundary unavailable", {
      route: "lender_deal_detail",
    });
    return json({ ok: false, error: "lender_deal_state_unavailable" }, 503);
  }
}
