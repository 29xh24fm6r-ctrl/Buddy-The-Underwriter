import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { isIntakeConfirmationGateEnabled } from "@/lib/flags/intakeConfirmationGate";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/intake/review
 *
 * Returns documents sorted by classification confidence ASC (worst first).
 * Used by the IntakeReviewTable UI component.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404 :
        access.error === "tenant_mismatch" ? 403 : 401;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    // Load deal phase
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // Load documents sorted by confidence ASC (nulls first = worst first)
    const { data: docs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select(
        `id, original_filename, canonical_type, document_type,
         checklist_key, doc_year,
         ai_doc_type, ai_confidence, ai_tax_year,
         classification_tier,
         gatekeeper_doc_type, gatekeeper_confidence,
         gatekeeper_needs_review, gatekeeper_route,
         intake_status, intake_confirmed_at, intake_confirmed_by,
         intake_locked_at, created_at`,
      )
      .eq("deal_id", dealId)
      .order("ai_confidence", { ascending: true, nullsFirst: true });

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: "query_failed", detail: docsErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      intake_phase: (deal as any).intake_phase,
      feature_enabled: isIntakeConfirmationGateEnabled(),
      documents: docs ?? [],
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[intake/review]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
