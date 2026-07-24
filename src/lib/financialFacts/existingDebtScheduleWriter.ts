import "server-only";

/**
 * DB-touching half of the existing-debt-schedule module — see
 * existingDebtSchedule.ts for the pure logic this calls into. Split apart
 * so the pure logic stays testable under plain `node --test` (this file's
 * `import "server-only"` throws outside a `react-server` resolution
 * condition — see docs/archive/brokerage-sba-ready-v1/T1-AAR.md).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  upsertDealFinancialFact,
  SENTINEL_UUID,
} from "@/lib/financialFacts/writeFact";
import {
  computeActiveAnnualDebtService,
  isReplaceableExistingDebt,
  toExistingDebtItems,
  type ExistingDebtScheduleRow,
  type ExistingDebtScheduleSource,
} from "./existingDebtSchedule";

type SbClient = { from: (table: string) => any };

export type ListedExistingDebtRow = ExistingDebtScheduleRow & { id: string };

export async function listExistingDebtScheduleEntries(
  dealId: string,
  sb: SbClient = supabaseAdmin(),
): Promise<ListedExistingDebtRow[]> {
  const { data, error } = await sb
    .from("deal_existing_debt_schedule")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`deal_existing_debt_schedule select: ${error.message}`);
  return (data ?? []) as ListedExistingDebtRow[];
}

export async function insertExistingDebtScheduleEntry(
  args: {
    dealId: string;
    bankId?: string | null;
    lenderName: string;
    loanType?: string | null;
    originalAmount?: number | null;
    currentBalance?: number | null;
    interestRatePct?: number | null;
    maturityDate?: string | null;
    monthlyPayment?: number | null;
    annualDebtService?: number | null;
    isBeingRefinanced?: boolean;
    notes?: string | null;
    source: ExistingDebtScheduleSource;
  },
  sb: SbClient = supabaseAdmin(),
): Promise<{ ok: true; row: ListedExistingDebtRow } | { ok: false; error: string }> {
  if (!args.lenderName || !args.lenderName.trim()) {
    return { ok: false, error: "lender_name is required" };
  }
  const row = {
    deal_id: args.dealId,
    bank_id: args.bankId ?? null,
    lender_name: args.lenderName.trim(),
    loan_type: args.loanType ?? null,
    original_amount: args.originalAmount ?? null,
    current_balance: args.currentBalance ?? null,
    interest_rate_pct: args.interestRatePct ?? null,
    maturity_date: args.maturityDate ?? null,
    monthly_payment: args.monthlyPayment ?? null,
    annual_debt_service: args.annualDebtService ?? null,
    is_being_refinanced: args.isBeingRefinanced ?? false,
    notes: args.notes ?? null,
    source: args.source,
  };
  const { data, error } = await sb
    .from("deal_existing_debt_schedule")
    .insert(row)
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as ListedExistingDebtRow };
}

/** Scoped to dealId so a borrower session can never delete another deal's row. */
export async function deleteExistingDebtScheduleEntry(
  args: { id: string; dealId: string },
  sb: SbClient = supabaseAdmin(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error, count } = await sb
    .from("deal_existing_debt_schedule")
    .delete({ count: "exact" })
    .eq("id", args.id)
    .eq("deal_id", args.dealId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "not found" };
  return { ok: true };
}

/**
 * Bridges deal_existing_debt_schedule (the canonical line-item table) into
 * the two places downstream consumers actually read a scalar/array from:
 *   1. deal_financial_facts fact_key "ADS" — read by
 *      sbaAssumptionsPrefill.ts on first assumptions-row creation.
 *   2. buddy_sba_assumptions.loan_impact.existingDebt — read directly by
 *      sbaForwardModelBuilder.ts's DSCR calc on every subsequent run, for
 *      deals where an assumptions row already exists. Only overwritten
 *      when it's still empty/the fabricated placeholder (see
 *      isReplaceableExistingDebt) — never clobbers a banker's or
 *      borrower's real edits.
 *
 * computeTotalDebtService.ts (the Underwriter-cockpit DSCR pipeline) reads
 * deal_existing_debt_schedule directly already and needs no bridge.
 *
 * Call this after every write (insert/delete) to the schedule. Non-fatal:
 * returns diagnostics instead of throwing, matching this codebase's
 * "a write-through failure never breaks the caller" convention
 * (propagateBorrowerFacts.ts uses the same shape).
 */
export async function syncExistingDebtScheduleToDownstream(
  args: { dealId: string; bankId: string; confirmNoDebt?: boolean },
  sb: SbClient = supabaseAdmin(),
): Promise<{ ok: boolean; wrote: string[]; skipped: string[]; errors: string[] }> {
  const wrote: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const rows = await listExistingDebtScheduleEntries(args.dealId, sb).catch((e) => {
    errors.push(`list: ${e instanceof Error ? e.message : String(e)}`);
    return [] as ListedExistingDebtRow[];
  });

  // Only write a real number when there's something to sum, or the borrower
  // has explicitly confirmed zero existing debt — an empty list on its own
  // never implies zero (it might just mean "not entered yet").
  if (rows.length === 0 && !args.confirmNoDebt) {
    skipped.push("ADS fact (no rows and no explicit zero-debt confirmation)");
  } else {
    const annualSum = computeActiveAnnualDebtService(rows);
    try {
      const { data: existingFact } = await sb
        .from("deal_financial_facts")
        .select("id, fact_type")
        .eq("deal_id", args.dealId)
        .eq("fact_key", "ADS")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // A document-extracted ADS fact always wins over this derived
      // aggregate — same precedence rule propagateBorrowerFacts.ts applies
      // to every other concierge-sourced fact key.
      if (existingFact && existingFact.fact_type !== "concierge") {
        skipped.push("ADS fact (document fact present)");
      } else {
        const res = await upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "concierge",
          factKey: "ADS",
          factValueNum: annualSum,
          confidence: 0.7,
          provenance: {
            source_type: "MANUAL",
            source_ref: `deal_existing_debt_schedule:${args.dealId}`,
            as_of_date: new Date().toISOString().slice(0, 10),
            extractor: "syncExistingDebtScheduleToDownstream:v1",
            ...(args.confirmNoDebt ? { note: "borrower confirmed no existing business debt" } : {}),
          } as any,
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
          allowSentinelPeriod: true,
        });
        if (res.ok) wrote.push("fact:ADS");
        else errors.push(`fact:ADS: ${res.error}`);
      }
    } catch (e) {
      errors.push(`fact:ADS: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // buddy_sba_assumptions.loan_impact.existingDebt — only if an assumptions
  // row already exists (if not, the next prefill run picks up the ADS fact
  // written above on its own).
  try {
    const { data: assumptions } = await sb
      .from("buddy_sba_assumptions")
      .select("id, loan_impact")
      .eq("deal_id", args.dealId)
      .maybeSingle();

    if (!assumptions) {
      skipped.push("buddy_sba_assumptions (no row yet — prefill will pick up the ADS fact)");
    } else {
      const loanImpact = (assumptions.loan_impact ?? {}) as Record<string, unknown>;
      const current = (loanImpact.existingDebt ?? null) as
        | ReturnType<typeof toExistingDebtItems>
        | null;

      if (!isReplaceableExistingDebt(current)) {
        skipped.push("buddy_sba_assumptions.loan_impact.existingDebt (already has real entries)");
      } else {
        const items = toExistingDebtItems(rows);
        if (items.length === 0 && !args.confirmNoDebt) {
          skipped.push("buddy_sba_assumptions.loan_impact.existingDebt (nothing to write yet)");
        } else {
          const { error } = await sb
            .from("buddy_sba_assumptions")
            .update({ loan_impact: { ...loanImpact, existingDebt: items } })
            .eq("id", assumptions.id);
          if (error) errors.push(`buddy_sba_assumptions: ${error.message}`);
          else wrote.push("buddy_sba_assumptions.loan_impact.existingDebt");
        }
      }
    }
  } catch (e) {
    errors.push(`buddy_sba_assumptions: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { ok: errors.length === 0, wrote, skipped, errors };
}
