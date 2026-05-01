import type { Pool } from 'pg';
import type { Item19Result } from './types.js';

/** Upsert each Item 19 metric into fdd_item19_facts. The unique constraint
 *  is (brand_id, filing_year, metric_name, cohort_definition) — for rows
 *  with NULL cohort_definition, Postgres treats NULL as distinct, so a
 *  brand-year can have at most one row per metric_name when no cohort is
 *  given (which is what we want). Returns the number of rows upserted. */
export async function upsertItem19Facts(
  pool: Pool,
  args: {
    brandId: string;
    filingId: string;
    filingYear: number;
    item19: Item19Result;
    extractionConfidence: number;
  }
): Promise<number> {
  if (!args.item19.hasItem19) return 0;
  let count = 0;
  for (const metric of args.item19.metrics) {
    if (!metric.metricName || metric.value === null) continue;

    await pool.query(
      `INSERT INTO fdd_item19_facts
         (brand_id, filing_id, filing_year, metric_name, metric_type,
          value, cohort_definition, cohort_size, percentile_rank,
          source_page, extraction_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (brand_id, filing_year, metric_name, cohort_definition)
       DO UPDATE SET
         value = EXCLUDED.value,
         metric_type = EXCLUDED.metric_type,
         cohort_size = EXCLUDED.cohort_size,
         percentile_rank = EXCLUDED.percentile_rank,
         source_page = EXCLUDED.source_page,
         extraction_confidence = EXCLUDED.extraction_confidence,
         filing_id = EXCLUDED.filing_id`,
      [
        args.brandId,
        args.filingId,
        args.filingYear,
        metric.metricName,
        metric.metricType,
        metric.value,
        metric.cohortDefinition,
        metric.cohortSize,
        metric.percentileRank,
        metric.sourcePage,
        args.extractionConfidence,
      ]
    );
    count++;
  }
  return count;
}
