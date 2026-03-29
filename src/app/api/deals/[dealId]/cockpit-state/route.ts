import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";
import { computeReadinessAndBlockers } from "@/lib/documentTruth/computeReadinessAndBlockers";
import { getRequirementsForDealType } from "@/lib/documentTruth/requirementRegistry";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/cockpit-state
 *
 * Single source of truth for the entire cockpit.
 * Returns deal identity, document state, readiness, blockers, permissions.
 * All panels must derive from this response — no independent queries.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const { searchParams } = new URL(req.url);
    const forceRecompute = searchParams.get("recompute") === "1";

    // ── Deal + Borrower identity ──────────────────────────────────────────
    const { data: deal } = await sb
      .from("deals")
      .select("id, name, borrower_name, borrower_id, bank_id, lifecycle_stage, deal_type")
      .eq("id", dealId)
      .single();

    if (!deal) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    // Resolve borrower
    let borrower: { id: string; legal_name: string } | null = null;
    if (deal.borrower_id) {
      const { data: b } = await sb
        .from("borrowers")
        .select("id, legal_name")
        .eq("id", deal.borrower_id)
        .maybeSingle();
      borrower = b ? { id: b.id, legal_name: b.legal_name ?? "" } : null;
    }

    // Resolve bank
    const { data: bank } = await sb
      .from("banks")
      .select("id, name")
      .eq("id", deal.bank_id)
      .maybeSingle();

    // ── Recompute if needed ───────────────────────────────────────────────
    if (forceRecompute) {
      await recomputeDealDocumentState(dealId);
    }

    // ── Load document snapshot ────────────────────────────────────────────
    const { data: snapshot } = await sb
      .from("deal_document_snapshots")
      .select("requirement_state, readiness, blockers, computed_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    // ── Load supplemental state ───────────────────────────────────────────
    const { data: loanRequest } = await sb
      .from("deal_loan_requests")
      .select("id")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    const { data: spreads } = await sb
      .from("deal_spreads")
      .select("id")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    const { data: financialSnapshot } = await sb
      .from("financial_snapshots")
      .select("id")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    // ── Compute readiness + blockers ──────────────────────────────────────
    const reqState = (snapshot?.requirement_state ?? []) as Array<{
      code: string;
      label: string;
      group: string;
      required: boolean;
      checklistStatus: string;
      readinessStatus: string;
      matchedDocumentIds: string[];
      reasons: string[];
    }>;

    const dealType = (deal as Record<string, unknown>).deal_type as string ?? "conventional";
    const applicableRequirements = getRequirementsForDealType(dealType);
    const applicableCodes = new Set<string>(applicableRequirements.map((r) => r.code));

    const readinessInput = {
      requirements: reqState.map((r) => ({
        code: r.code,
        label: r.label,
        group: r.group,
        required: r.required,
        applicable: applicableCodes.has(r.code),
        checklistStatus: r.checklistStatus as "missing" | "received" | "satisfied" | "waived",
        reviewPending: r.readinessStatus === "warning",
        matchedDocumentCount: r.matchedDocumentIds?.length ?? 0,
      })),
      hasLoanRequest: !!loanRequest,
      hasSpreads: !!spreads,
      hasFinancialSnapshot: !!financialSnapshot,
      hasPricingQuote: false,
      hasDecision: false,
    };

    const { categories, blockers, readinessPercent } = computeReadinessAndBlockers(readinessInput);

    return NextResponse.json({
      ok: true,
      deal: {
        id: deal.id,
        dealName: deal.name,
        borrower: borrower
          ? { id: borrower.id, legalName: borrower.legal_name }
          : null,
        bank: bank ? { id: bank.id, name: bank.name } : null,
        lifecycleStage: deal.lifecycle_stage,
      },
      documentState: {
        requirements: reqState,
        computedAt: snapshot?.computed_at ?? null,
      },
      readiness: {
        percent: readinessPercent,
        categories,
      },
      blockers,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
