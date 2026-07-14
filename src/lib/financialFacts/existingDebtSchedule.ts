/**
 * Existing business debt schedule — pure logic.
 *
 * deal_existing_debt_schedule is the single source of truth for a deal's
 * existing business debt, whether the row came from a banker's manual entry
 * (source='manual_banker', the original path), a Brokerage borrower's manual
 * entry (source='manual_borrower', added by SPEC-BROKERAGE-SBA-READY-V1's
 * debt-schedule-wiring follow-up), or — once Plaid is actually wired up — a
 * future auto-builder (source='plaid_auto', see debtScheduleEntryToRow below).
 *
 * No DB, no server-only import: this file must stay pure and directly
 * unit-testable under plain `node --test` (see
 * docs/archive/brokerage-sba-ready-v1/T1-AAR.md for why that constraint
 * matters in this codebase — a sibling file that imports "server-only"
 * needed a test quarantine + a react-server condition workaround).
 */

import type {
  BorrowerBankTransactionLike,
  DebtScheduleEntry,
} from "./debtScheduleAutoBuilder";

export type ExistingDebtScheduleSource = "manual_banker" | "manual_borrower" | "plaid_auto";

export type ExistingDebtScheduleRow = {
  id?: string;
  deal_id: string;
  bank_id?: string | null;
  lender_name: string;
  loan_type?: string | null;
  original_amount?: number | null;
  current_balance?: number | null;
  interest_rate_pct?: number | null;
  maturity_date?: string | null;
  monthly_payment?: number | null;
  annual_debt_service?: number | null;
  is_being_refinanced?: boolean;
  included_in_global?: boolean;
  notes?: string | null;
  source?: ExistingDebtScheduleSource;
  confidence?: number | null;
};

export type ExistingDebtItem = {
  description: string;
  currentBalance: number;
  monthlyPayment: number;
  remainingTermMonths: number;
};

/**
 * The exact single-item placeholder loadSBAAssumptionsPrefill() fabricates
 * from a bare ADS fact when no real line items exist yet (see
 * sbaAssumptionsPrefill.ts). Exported so both the placeholder-detection
 * logic here and its test stay pinned to one literal.
 */
export const PLACEHOLDER_EXISTING_DEBT_DESCRIPTION =
  "Existing debt obligations (from spread)";

function isActiveRow(row: ExistingDebtScheduleRow): boolean {
  return row.is_being_refinanced !== true && row.included_in_global !== false;
}

/** Annual debt service across every active (not-being-refinanced, included-in-global) row. */
export function computeActiveAnnualDebtService(
  rows: ExistingDebtScheduleRow[],
): number {
  return rows.filter(isActiveRow).reduce((sum, row) => {
    const annual =
      row.annual_debt_service ??
      (row.monthly_payment != null ? row.monthly_payment * 12 : null);
    return sum + (annual ?? 0);
  }, 0);
}

function monthsUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (!Number.isFinite(target)) return null;
  const now = Date.now();
  const months = (target - now) / (30.44 * 86_400_000);
  return months > 0 ? Math.round(months) : null;
}

/**
 * Converts active rows into the ExistingDebtItem[] shape
 * buddy_sba_assumptions.loan_impact.existingDebt (and, downstream,
 * sbaForwardModelBuilder.ts's DSCR calc) actually consumes. This is the
 * per-creditor detail the single fabricated ADS-derived placeholder item
 * never had.
 */
export function toExistingDebtItems(
  rows: ExistingDebtScheduleRow[],
): ExistingDebtItem[] {
  return rows.filter(isActiveRow).map((row) => ({
    description: row.loan_type
      ? `${row.lender_name} (${row.loan_type})`
      : row.lender_name,
    currentBalance: row.current_balance ?? 0,
    monthlyPayment:
      row.monthly_payment ??
      (row.annual_debt_service != null ? row.annual_debt_service / 12 : 0),
    remainingTermMonths: monthsUntil(row.maturity_date) ?? 60,
  }));
}

/**
 * True when the stored loanImpact.existingDebt is safe to overwrite with
 * real data: empty, or exactly the single fabricated prefill placeholder.
 * Anything else is either real borrower/banker-entered data or an
 * already-confirmed assumptions row — never silently overwritten, matching
 * the "fill if null" precedence convention propagateBorrowerFacts.ts and
 * sbaAssumptionsBootstrap.ts already use elsewhere in this codebase.
 */
export function isReplaceableExistingDebt(
  current: ExistingDebtItem[] | null | undefined,
): boolean {
  if (!current || current.length === 0) return true;
  return (
    current.length === 1 &&
    current[0]?.description === PLACEHOLDER_EXISTING_DEBT_DESCRIPTION
  );
}

/**
 * The Plaid drop-in seam: once Brokerage has a live Plaid connection, a job
 * calls buildDebtSchedule() (debtScheduleAutoBuilder.ts) against real
 * transactions and maps each DebtScheduleEntry through this function before
 * writing to deal_existing_debt_schedule via the same writer every other
 * source uses — no new table, no new shape, no second migration needed.
 *
 * is_being_refinanced defaults to false: bank transactions alone can't tell
 * us a debt is being paid off by the new SBA loan, so a suggested entry
 * always starts as "counts toward existing debt" until a human confirms
 * otherwise (matching debtScheduleAutoBuilder.ts's own "suggestion, not
 * authority" framing).
 */
export function debtScheduleEntryToRow(
  entry: DebtScheduleEntry,
  args: { dealId: string; bankId?: string | null },
): ExistingDebtScheduleRow {
  return {
    deal_id: args.dealId,
    bank_id: args.bankId ?? null,
    lender_name: entry.creditor,
    loan_type: entry.account_type_inferred,
    current_balance: entry.estimated_balance,
    monthly_payment: entry.monthly_payment,
    annual_debt_service: entry.monthly_payment * 12,
    is_being_refinanced: false,
    included_in_global: true,
    source: "plaid_auto",
    confidence: entry.confidence,
  };
}

export type { BorrowerBankTransactionLike, DebtScheduleEntry };
