/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream E: rent-roll loader.
 *
 * Reads `deal_rent_roll_rows` (per-unit rents/occupancy/concessions) and
 * `deal_collateral_items` (property value for the LTV leg) for a deal, mapping
 * them to the pure computePropertyNoi inputs. DB access is imported LAZILY (like
 * loadFinengineMemo), so this module stays importable + unit-testable under the
 * test runner; tests inject `loadRentRoll`/`loadCollateral`. Read-only.
 *
 * DATA REALITY (§0): `deal_rent_roll_rows` is EMPTY today — every live deal
 * returns `rows: []` ⇒ `computePropertyNoi → null`. MULTI-PROPERTY GAP: the rows
 * carry no `property_id`, so `multiPropertyRepresentable` is always false and the
 * whole rent roll is one property (see propertyNoi.ts docblock).
 */

import { computePropertyNoi, type RentRollUnit, type PropertyNoiResult } from "@/lib/finengine/sizing/propertyNoi";

export type PropertyCollateral = { appraisedValue: number | null; marketValue: number | null };

export type PropertyNoiLoaders = {
  loadRentRoll?: (dealId: string) => Promise<RentRollUnit[]>;
  loadCollateral?: (dealId: string) => Promise<PropertyCollateral>;
};

export type LoadedPropertyNoi = {
  /** False until an upstream `property_id` lands on the rent-roll row (§0 STOP). */
  multiPropertyRepresentable: false;
  rentRollUnitCount: number;
  noi: PropertyNoiResult | null;
  propertyValue: number | null;
  /** True when 0 rent-roll rows exist — the live state today. */
  noRentRollData: boolean;
};

async function defaultLoadRentRoll(dealId: string): Promise<RentRollUnit[]> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_rent_roll_rows")
    .select("unit_id, unit_type, monthly_rent, annual_rent, market_rent_monthly, occupancy_status, concessions_monthly")
    .eq("deal_id", dealId);
  if (error) throw new Error(`[loadPropertyNoiInputs] rent roll ${dealId}: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({
    unitId: r.unit_id ?? null,
    unitType: r.unit_type ?? null,
    monthlyRent: r.monthly_rent == null ? null : Number(r.monthly_rent),
    annualRent: r.annual_rent == null ? null : Number(r.annual_rent),
    marketRentMonthly: r.market_rent_monthly == null ? null : Number(r.market_rent_monthly),
    occupancyStatus: r.occupancy_status ?? null,
    concessionsMonthly: r.concessions_monthly == null ? null : Number(r.concessions_monthly),
  }));
}

async function defaultLoadCollateral(dealId: string): Promise<PropertyCollateral> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_collateral_items")
    .select("appraised_value, market_value")
    .eq("deal_id", dealId)
    .order("appraised_value", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { appraisedValue: data?.appraised_value ?? null, marketValue: data?.market_value ?? null };
}

/**
 * Load a deal's rent-roll-derived NOI inputs and compute the single-property NOI.
 * `operatingExpenses`/`vacancyFactor` are caller-supplied (not in the rent-roll
 * schema). Returns `noRentRollData: true` + `noi: null` when no rows exist.
 */
export async function loadPropertyNoiInputs(
  dealId: string,
  opts: { operatingExpenses: number; vacancyFactor?: number | null; loaders?: PropertyNoiLoaders },
): Promise<LoadedPropertyNoi> {
  const rows = await (opts.loaders?.loadRentRoll ?? defaultLoadRentRoll)(dealId);
  const collateral = await (opts.loaders?.loadCollateral ?? defaultLoadCollateral)(dealId);
  const propertyValue = collateral.appraisedValue ?? collateral.marketValue ?? null;
  const noi = computePropertyNoi(rows, { operatingExpenses: opts.operatingExpenses, vacancyFactor: opts.vacancyFactor });
  return {
    multiPropertyRepresentable: false,
    rentRollUnitCount: rows.length,
    noi,
    propertyValue,
    noRentRollData: rows.length === 0,
  };
}
