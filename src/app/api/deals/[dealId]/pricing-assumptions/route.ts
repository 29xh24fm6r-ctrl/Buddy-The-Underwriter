import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ──────────────────────────────────────────────────────────────
// GET — fetch current pricing assumptions for a deal
// ──────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    // Use canonical resolver — it detects stale/invalid pricing inputs,
    // repairs them, persists the repair, and returns consistent data.
    const { resolveCanonicalPricingContext } = await import(
      "@/lib/pricing/resolveCanonicalPricingContext"
    );
    const canonical = await resolveCanonicalPricingContext(dealId, auth.bankId);

    // After resolution (which may have persisted repairs), read the current row
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_pricing_inputs")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      pricingAssumptions: data ?? null,
      ...(canonical.repair_applied ? {
        repaired: true,
        repairReason: canonical.repair_reason,
      } : {}),
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[pricing-assumptions GET]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────
// POST — create defaults (idempotent: returns existing if present)
// Seeds from deal_loan_requests when available.
// ──────────────────────────────────────────────────────────────
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const sb = supabaseAdmin();

    // Idempotent: return existing if present
    const { data: existing } = await sb
      .from("deal_pricing_inputs")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, pricingAssumptions: existing });
    }

    // Pull sane defaults: structural pricing > loan request > hardcoded defaults.
    // Precedence ensures the banker sees values consistent with what /spreads already uses.
    const [{ data: sp }, { data: lr }] = await Promise.all([
      sb
        .from("deal_structural_pricing")
        .select("loan_amount, rate_type, rate_index, index_rate_pct, requested_spread_bps, annual_debt_service_est")
        .eq("deal_id", dealId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("deal_loan_requests")
        .select(
          "requested_amount, requested_term_months, requested_amort_months, requested_rate_type, requested_rate_index, requested_spread_bps, requested_interest_only_months",
        )
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Rate type: structural pricing > loan request > default
    const spRateType = sp?.rate_type === "variable" ? "floating" : sp?.rate_type === "fixed" ? "fixed" : null;
    const lrRateType = lr?.requested_rate_type === "VARIABLE" ? "floating" : lr?.requested_rate_type === "FIXED" ? "fixed" : null;
    const rateType = spRateType ?? lrRateType ?? "floating";

    // Index code: structural pricing > loan request > default
    const VALID_INDEX_CODES = new Set(["SOFR", "UST_5Y", "PRIME"]);
    const spIndex = sp?.rate_index && VALID_INDEX_CODES.has(sp.rate_index) ? sp.rate_index : null;
    const lrIndex = lr?.requested_rate_index && VALID_INDEX_CODES.has(lr.requested_rate_index) ? lr.requested_rate_index : null;
    const indexCode = spIndex ?? lrIndex ?? "SOFR";

    // Index rate: structural pricing > null (populated by live rates on client)
    const indexRatePct = sp?.index_rate_pct != null ? Number(sp.index_rate_pct) : null;

    const defaults = {
      deal_id: dealId,
      rate_type: rateType,
      index_code: indexCode,
      index_rate_pct: Number.isFinite(indexRatePct) ? indexRatePct : null,
      fixed_rate_pct: null,
      floor_rate_pct: null,
      spread_override_bps: sp?.requested_spread_bps ?? lr?.requested_spread_bps ?? null,
      loan_amount: sp?.loan_amount ?? lr?.requested_amount ?? null,
      term_months: lr?.requested_term_months ?? 120,
      amort_months: lr?.requested_amort_months ?? 300,
      interest_only_months: lr?.requested_interest_only_months ?? 0,
      origination_fee_pct: null,
      closing_costs: null,
      include_existing_debt: true,
      include_proposed_debt: true,
      notes: null,
    };

    const { data, error } = await sb
      .from("deal_pricing_inputs")
      .insert(defaults)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, pricingAssumptions: data });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[pricing-assumptions POST]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────
// PUT — upsert pricing assumptions + trigger structural recompute
// ──────────────────────────────────────────────────────────────

type ValidationError = { field: string; message: string };

function validateBody(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  const loanAmount = Number(body.loan_amount);
  if (!body.loan_amount || !Number.isFinite(loanAmount) || loanAmount <= 0) {
    errors.push({ field: "loan_amount", message: "Loan amount is required and must be > 0" });
  }

  const amortMonths = Number(body.amort_months ?? 300);
  if (!Number.isFinite(amortMonths) || amortMonths <= 0) {
    errors.push({ field: "amort_months", message: "Amortization months must be > 0" });
  }

  const ioMonths = Number(body.interest_only_months ?? 0);
  if (ioMonths < 0) {
    errors.push({ field: "interest_only_months", message: "Interest-only months must be >= 0" });
  }
  if (ioMonths > amortMonths) {
    errors.push({
      field: "interest_only_months",
      message: "Interest-only months cannot exceed amortization months",
    });
  }

  const rateType = body.rate_type as string;
  if (rateType !== "fixed" && rateType !== "floating") {
    errors.push({ field: "rate_type", message: "Rate type must be 'fixed' or 'floating'" });
  }

  if (rateType === "fixed") {
    const fixedRate = Number(body.fixed_rate_pct);
    if (body.fixed_rate_pct == null || !Number.isFinite(fixedRate) || fixedRate <= 0) {
      errors.push({
        field: "fixed_rate_pct",
        message: "Fixed rate is required for fixed-rate loans and must be > 0",
      });
    }
  }

  if (rateType === "floating") {
    // Spread can be 0 (Prime flat), negative (Prime - 25bps), or positive.
    // Reject only null/undefined/blank/non-finite — not zero.
    const spreadBps = Number(body.spread_override_bps);
    if (body.spread_override_bps == null || !Number.isFinite(spreadBps)) {
      errors.push({
        field: "spread_override_bps",
        message: "Spread (bps) is required for floating-rate loans",
      });
    } else if (spreadBps < -500 || spreadBps > 2000) {
      errors.push({
        field: "spread_override_bps",
        message: "Spread must be between -500 and 2000 bps",
      });
    }
  }

  return errors;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();

    // ── Validate ──
    const validationErrors = validateBody(body);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { ok: false, error: "validation_failed", errors: validationErrors },
        { status: 422 },
      );
    }

    // ── Build upsert payload ──
    const patch = {
      deal_id: dealId,
      index_code: body.index_code ?? "SOFR",
      index_tenor: body.index_tenor ?? null,
      index_rate_pct: body.index_rate_pct != null ? Number(body.index_rate_pct) : null,
      base_rate_override_pct:
        body.base_rate_override_pct != null ? Number(body.base_rate_override_pct) : null,
      spread_override_bps:
        body.spread_override_bps != null ? Number(body.spread_override_bps) : null,
      loan_amount: Number(body.loan_amount),
      term_months: Number(body.term_months ?? 120),
      amort_months: Number(body.amort_months ?? 300),
      interest_only_months: Number(body.interest_only_months ?? 0),
      rate_type: body.rate_type ?? "floating",
      fixed_rate_pct: body.fixed_rate_pct != null ? Number(body.fixed_rate_pct) : null,
      floor_rate_pct: body.floor_rate_pct != null ? Number(body.floor_rate_pct) : null,
      origination_fee_pct:
        body.origination_fee_pct != null ? Number(body.origination_fee_pct) : null,
      closing_costs: body.closing_costs != null ? Number(body.closing_costs) : null,
      include_existing_debt: body.include_existing_debt ?? true,
      include_proposed_debt: body.include_proposed_debt ?? true,
      notes: body.notes ?? null,
    };

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_pricing_inputs")
      .upsert(patch, { onConflict: "deal_id" })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // ── Post-save pipeline (fire-and-forget) ──
    // 1. Compute structural pricing from inputs
    // 2. Compute total debt service (writes facts + DSCR)
    // 3. Write ledger event
    const bankId = auth.bankId;
    const inputs = data as any;

    Promise.resolve()
      .then(async () => {
        const { computeStructuralPricingFromInputs } = await import(
          "@/lib/structuralPricing/computeStructuralPricingFromInputs"
        );
        const spResult = await computeStructuralPricingFromInputs({
          dealId,
          bankId,
          inputs,
        });

        if (!spResult.ok) {
          console.warn("[pricing-assumptions] structural pricing failed:", spResult.error);
          return;
        }

        // ── PASS 1: Build snapshot to compute + persist CASH_FLOW_AVAILABLE ──
        // computeTotalDebtService needs CASH_FLOW_AVAILABLE in deal_financial_facts.
        // The snapshot builder derives it from OBI+DEP+S179 if no direct fact exists.
        // We persist it here so the DSCR chain can find it in Pass 2.
        const {
          buildDealFinancialSnapshotForBank,
          persistCashFlowAvailableFromSnapshot,
        } = await import("@/lib/deals/financialSnapshot");
        const { persistFinancialSnapshot } = await import(
          "@/lib/deals/financialSnapshotPersistence"
        );

        const pass1Snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
        await persistCashFlowAvailableFromSnapshot({ dealId, bankId, snapshot: pass1Snapshot });

        // ── PASS 2: Compute total debt service — now CASH_FLOW_AVAILABLE exists ──
        const { computeTotalDebtService } = await import(
          "@/lib/structuralPricing/computeTotalDebtService"
        );
        const dsResult = await computeTotalDebtService({
          dealId,
          bankId,
          skipExistingDebt: inputs.include_existing_debt === false,
        });

        if (!dsResult.ok) {
          console.warn("[pricing-assumptions] debt service failed:", dsResult.error);
        }

        // ── PASS 3: Final snapshot — now includes DSCR + DSCR_stressed ──
        const finalSnapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
        await persistFinancialSnapshot({ dealId, bankId, snapshot: finalSnapshot });

        // Write ledger event
        const { logLedgerEvent } = await import("@/lib/pipeline/logLedgerEvent");
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "pricing_inputs.saved",
          uiState: "done",
          uiMessage: "Pricing assumptions saved — structural pricing recomputed",
          meta: {
            loan_amount: inputs.loan_amount,
            rate_type: inputs.rate_type,
            structural_rate_pct: spResult.data.structural_rate_pct,
            annual_debt_service_est: spResult.data.annual_debt_service_est,
            dscr: dsResult.ok ? dsResult.data.dscr : null,
            completeness_pct: finalSnapshot.completeness_pct,
          },
        });
      })
      .catch((err: any) => {
        console.warn("[pricing-assumptions] pipeline error (non-fatal):", err?.message);
      });

    return NextResponse.json({ ok: true, pricingAssumptions: data });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[pricing-assumptions PUT]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
