/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream E: per-property NOI.
 *
 * A pure NOI builder from a property's rent roll, feeding the CRE sizing path
 * (sizeCre) so the per-property leg consumes real rent-roll-derived NOI once
 * extraction populates rows.
 *
 *   grossPotentialRent   = Σ annual_rent (or monthly_rent × 12) across units
 *   vacancyLoss          = rent of vacant units (by occupancy_status) OR GPR × vacancy_factor
 *   effectiveGrossIncome = grossPotentialRent − vacancyLoss − Σ concessions
 *   NOI                  = effectiveGrossIncome − operatingExpenses
 *
 * ── DATA REALITY (§0, verified 2026-06-28) ──────────────────────────────────
 * `deal_rent_roll_rows` is EMPTY (0 live rows) — so this model is FIXTURE-TESTED
 * and produces NO live numbers until rent-roll extraction populates rows. The
 * loader (`loadPropertyNoiInputs`) reads the real schema with the lazy-supabase /
 * injectable pattern, but every live deal returns `{ noi: null, … }` today.
 *
 * ── MULTI-PROPERTY GAP (§0 STOP) ────────────────────────────────────────────
 * `deal_rent_roll_rows` carries `unit_id`/`unit_type` but NO `property_id`, so a
 * deal's rent roll cannot be split into multiple properties from the schema. This
 * model implements the SINGLE-PROPERTY path: every unit is treated as belonging
 * to ONE property. Per-property NOI for a genuinely multi-property deal needs an
 * upstream schema add (a `property_id` on the rent-roll row) — OUT OF SCOPE here.
 * The loader surfaces `multiPropertyRepresentable: false` so callers know the
 * single-property assumption is in force. Pure (the model); read-only (the loader).
 */

import { sizeCre, type SizingResult } from "@/lib/finengine/sizing";
import type { PolicyContext } from "@/lib/finengine/contracts";

/** A rent-roll unit (subset of deal_rent_roll_rows relevant to NOI). */
export type RentRollUnit = {
  unitId?: string | null;
  unitType?: string | null;
  monthlyRent?: number | null;
  annualRent?: number | null;
  marketRentMonthly?: number | null;
  occupancyStatus?: string | null; // e.g. "occupied" | "vacant"
  concessionsMonthly?: number | null;
};

export type PropertyNoiResult = {
  unitCount: number;
  occupiedUnits: number;
  vacantUnits: number;
  grossPotentialRent: number;
  vacancyLoss: number;
  concessions: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  noi: number;
  /** How vacancy was derived: from occupancy_status, or an explicit factor. */
  vacancyBasis: "occupancy_status" | "vacancy_factor";
  note: string;
};

/** A unit's annual rent: annual_rent if present, else monthly_rent × 12. */
function annualRentOf(u: RentRollUnit): number {
  if (u.annualRent != null) return u.annualRent;
  if (u.monthlyRent != null) return u.monthlyRent * 12;
  return 0;
}

function isVacant(u: RentRollUnit): boolean {
  return (u.occupancyStatus ?? "").trim().toLowerCase() === "vacant";
}

/**
 * Compute a single property's NOI from its rent roll. Returns null when the rent
 * roll is empty (the live state today — "no rent-roll data"). When `vacancyFactor`
 * is supplied, vacancy is GPR × factor; otherwise it is the rent of units flagged
 * vacant by `occupancy_status`. Pure.
 */
export function computePropertyNoi(
  rows: RentRollUnit[],
  opts: { operatingExpenses: number; vacancyFactor?: number | null },
): PropertyNoiResult | null {
  if (!rows || rows.length === 0) return null;

  const grossPotentialRent = rows.reduce((s, u) => s + annualRentOf(u), 0);
  const concessions = rows.reduce((s, u) => s + (u.concessionsMonthly ?? 0) * 12, 0);
  const vacantUnits = rows.filter(isVacant).length;
  const occupiedUnits = rows.length - vacantUnits;

  let vacancyLoss: number;
  let vacancyBasis: PropertyNoiResult["vacancyBasis"];
  if (opts.vacancyFactor != null) {
    vacancyLoss = grossPotentialRent * opts.vacancyFactor;
    vacancyBasis = "vacancy_factor";
  } else {
    vacancyLoss = rows.filter(isVacant).reduce((s, u) => s + annualRentOf(u), 0);
    vacancyBasis = "occupancy_status";
  }

  const effectiveGrossIncome = grossPotentialRent - vacancyLoss - concessions;
  const noi = effectiveGrossIncome - opts.operatingExpenses;

  return {
    unitCount: rows.length,
    occupiedUnits,
    vacantUnits,
    grossPotentialRent,
    vacancyLoss,
    concessions,
    effectiveGrossIncome,
    operatingExpenses: opts.operatingExpenses,
    noi,
    vacancyBasis,
    note: `GPR ${fmt(grossPotentialRent)} − vacancy ${fmt(vacancyLoss)} (${vacancyBasis}) − concessions ${fmt(concessions)} = EGI ${fmt(effectiveGrossIncome)}; − opex ${fmt(opts.operatingExpenses)} = NOI ${fmt(noi)}.`,
  };
}

/**
 * Size a CRE facility from a rent roll: compute the property's NOI and feed it
 * (with property value + mortgage constant) into the existing sizeCre. Returns
 * null when the rent roll is empty (no NOI ⇒ no CRE sizing). Pure.
 */
export function sizeCreFromRentRoll(args: {
  rows: RentRollUnit[];
  operatingExpenses: number;
  propertyValue: number;
  annualConstantRate: number;
  vacancyFactor?: number | null;
  minDebtYield?: number;
  ctx?: PolicyContext;
}): { noi: PropertyNoiResult | null; sizing: SizingResult | null } {
  const noi = computePropertyNoi(args.rows, { operatingExpenses: args.operatingExpenses, vacancyFactor: args.vacancyFactor });
  if (noi == null) return { noi: null, sizing: null };
  const sizing = sizeCre({
    propertyValue: args.propertyValue,
    noi: noi.noi,
    annualConstantRate: args.annualConstantRate,
    minDebtYield: args.minDebtYield,
    ctx: args.ctx,
  });
  return { noi, sizing };
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
