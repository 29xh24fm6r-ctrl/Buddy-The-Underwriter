import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ──────────────────────────────────────────────────────────────
// GET — fetch current pricing assumptions for a deal
// ──────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_pricing_inputs")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, pricingAssumptions: data ?? null });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

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
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
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

    // Pull sane defaults from most recent loan request
    const { data: lr } = await sb
      .from("deal_loan_requests")
      .select(
        "requested_amount, requested_term_months, requested_amort_months, requested_rate_type, requested_spread_bps, requested_interest_only_months",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const rateType =
      lr?.requested_rate_type === "VARIABLE" ? "floating" : "fixed";

    const defaults = {
      deal_id: dealId,
      rate_type: rateType,
      index_code: "SOFR" as const,
      index_rate_pct: null,
      fixed_rate_pct: null,
      floor_rate_pct: null,
      spread_override_bps: lr?.requested_spread_bps ?? null,
      loan_amount: lr?.requested_amount ?? null,
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

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

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
    if (body.spread_override_bps == null) {
      errors.push({
        field: "spread_override_bps",
        message: "Spread (bps) is required for floating-rate loans",
      });
    }
  }

  return errors;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
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
    const bankId = access.bankId;
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

        // Compute total debt service (writes canonical facts + DSCR)
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
          },
        });
      })
      .catch((err: any) => {
        console.warn("[pricing-assumptions] pipeline error (non-fatal):", err?.message);
      });

    return NextResponse.json({ ok: true, pricingAssumptions: data });
  } catch (e: any) {
    rethrowNextErrors(e);

    if (e instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: e.code },
        { status: e.code === "not_authenticated" ? 401 : 403 },
      );
    }

    console.error("[pricing-assumptions PUT]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
