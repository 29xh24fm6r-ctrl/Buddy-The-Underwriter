import type { Pool } from 'pg';
import type {
  Item5Result,
  Item6Result,
  Item7Result,
  Item20Result,
} from './types.js';

/** Update franchise_brands.franchise_fee_min/max, royalty_pct, ad_fund_pct,
 *  initial_investment_min/max, net_worth_requirement, liquidity_requirement,
 *  unit_count, has_item_19 — but ONLY when the filing whose extraction we
 *  just ran is at least as recent as the year currently stamped on
 *  franchise_brands.economics_source_year. Most-recent-filing-wins.
 *
 *  Returns true if the brand row was updated, false if the filing was
 *  superseded by a newer extraction already on the row. */
export async function updateBrandEconomics(
  pool: Pool,
  args: {
    brandId: string;
    filingId: string;
    filingYear: number;
    item5: Item5Result | null;
    item6: Item6Result | null;
    item7: Item7Result | null;
    item20: Item20Result | null;
    hasItem19: boolean;
  }
): Promise<boolean> {
  // Single statement: WHERE filing_year is fresh enough. Returns 0 rows
  // if the brand already has economics from a more recent filing.
  const result = await pool.query(
    `UPDATE franchise_brands SET
       franchise_fee_min = COALESCE($1, franchise_fee_min),
       franchise_fee_max = COALESCE($2, franchise_fee_max),
       royalty_pct = COALESCE($3, royalty_pct),
       ad_fund_pct = COALESCE($4, ad_fund_pct),
       initial_investment_min = COALESCE($5, initial_investment_min),
       initial_investment_max = COALESCE($6, initial_investment_max),
       net_worth_requirement = COALESCE($7, net_worth_requirement),
       liquidity_requirement = COALESCE($8, liquidity_requirement),
       unit_count = COALESCE($9, unit_count),
       has_item_19 = $10,
       economics_source_filing_id = $11,
       economics_source_year = $12,
       updated_at = now()
     WHERE id = $13
       AND $12 >= COALESCE(economics_source_year, 0)`,
    [
      args.item5?.franchiseFeeMin ?? null,
      args.item5?.franchiseFeeMax ?? null,
      args.item6?.royaltyPct ?? null,
      args.item6?.adFundPct ?? null,
      args.item7?.totalInvestmentMin ?? null,
      args.item7?.totalInvestmentMax ?? null,
      args.item7?.netWorthRequirement ?? null,
      args.item7?.liquidityRequirement ?? null,
      args.item20?.totalUnits ?? null,
      args.hasItem19,
      args.filingId,
      args.filingYear,
      args.brandId,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}
