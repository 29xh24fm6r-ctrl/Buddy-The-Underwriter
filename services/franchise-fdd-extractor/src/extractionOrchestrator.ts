/**
 * Orchestrator: pick fdd_filings rows where extraction_status='pending',
 * download from GCS, slice + extract via Gemini, persist results.
 *
 * Three productivity levers built in:
 * 1. **sha256 dedup cache** — before any Gemini call, look for another
 *    fdd_filings row with the same pdf_sha256 + extraction_status='complete'.
 *    If found, copy the item_*_json columns from that row, parse them
 *    locally, upsert the same data for the current filing — skipping all
 *    Gemini calls entirely. NASAA brands have ~3 identical PDFs per
 *    franchisor (one per state); this saves 2/3 of the cost on those.
 * 2. **page-targeted extraction** — TOC scan reveals the page numbers
 *    for items 5/6/7/19/20; we only send the relevant page slice to
 *    Gemini, not the full 267-page PDF. Reduces input tokens ~98%.
 * 3. **most-recent-filing-wins for brand economics** — same brand may
 *    have multiple filings (one per state-year). Brand-level economics
 *    columns are only updated when the current filing's filing_year is
 *    >= economics_source_year. See investmentEconomicsParser.ts.
 */

import type { Pool } from 'pg';
import { downloadPdfFromGcs } from './gcsDownloader.js';
import { extractToc } from './tocExtractor.js';
import {
  extractItem5And6,
  extractItem7,
  extractItem19,
  extractItem20,
} from './itemExtractor.js';
import { upsertItem19Facts } from './item19Parser.js';
import { updateBrandEconomics } from './investmentEconomicsParser.js';
import type {
  ExtractionStats,
  FilingRow,
  Item19Result,
  Item20Result,
  Item5Result,
  Item6Result,
  Item7Result,
} from './types.js';

export interface ExtractOptions {
  batchSize?: number;
  delayMs?: number;
  maxErrors?: number;
}

export async function extractFddBatch(
  pool: Pool,
  options: ExtractOptions = {}
): Promise<ExtractionStats> {
  const batchSize = options.batchSize ?? 5;
  const delayMs = options.delayMs ?? 5000;
  const maxErrors = options.maxErrors ?? 5;

  const stats: ExtractionStats = {
    processed: 0,
    completed: 0,
    cacheHits: 0,
    failed: 0,
    skippedNoToc: 0,
    noItem19: 0,
    item19RowsUpserted: 0,
    brandsUpdated: 0,
    errors: [],
    remaining: 0,
    runId: '',
  };

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO franchise_sync_runs (source, status)
     VALUES ('fdd_extraction', 'running')
     RETURNING id`
  );
  const runId = runRes.rows[0]!.id;
  stats.runId = runId;
  const startTime = Date.now();

  try {
    const filingsRes = await pool.query<{
      id: string;
      brand_id: string;
      brand_name: string;
      filing_state: string;
      filing_year: number;
      gcs_path: string;
      pdf_sha256: string | null;
    }>(
      `SELECT ff.id, ff.brand_id, ff.filing_state, ff.filing_year,
              ff.gcs_path, ff.pdf_sha256, fb.brand_name
       FROM fdd_filings ff
       JOIN franchise_brands fb ON fb.id = ff.brand_id
       WHERE ff.extraction_status = 'pending'
         AND ff.gcs_path IS NOT NULL
       ORDER BY ff.created_at
       LIMIT $1`,
      [batchSize]
    );

    const remainingRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM fdd_filings
       WHERE extraction_status = 'pending' AND gcs_path IS NOT NULL`
    );
    stats.remaining = parseInt(remainingRes.rows[0]?.count ?? '0', 10);

    const filings: FilingRow[] = filingsRes.rows.map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      brandName: r.brand_name,
      filingState: r.filing_state,
      filingYear: r.filing_year,
      gcsPath: r.gcs_path,
      pdfSha256: r.pdf_sha256,
    }));

    let consecutiveErrors = 0;

    for (const filing of filings) {
      if (consecutiveErrors >= maxErrors) {
        console.log(
          `[extract] aborting: ${maxErrors} consecutive errors`
        );
        break;
      }

      stats.processed++;

      try {
        if (stats.processed > 1) await sleep(delayMs);
        await processOneFiling(pool, filing, stats);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        stats.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ filing_id: filing.id, brand_name: filing.brandName, error: msg });
        console.error(`[extract] FAILED ${filing.brandName} (${filing.id}): ${msg}`);
        // Mark filing as failed so we don't loop on it forever.
        try {
          await pool.query(
            `UPDATE fdd_filings SET extraction_status='failed', extraction_error=$1, updated_at=now() WHERE id=$2`,
            [msg.slice(0, 1000), filing.id]
          );
        } catch (markErr) {
          console.error(`[extract] also failed to mark filing as failed: ${markErr}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE franchise_sync_runs
       SET status = 'complete',
           total_rows_in_source = $1,
           brands_added = $2,
           brands_updated = $3,
           brands_unchanged = $4,
           error_count = $5,
           errors = $6,
           duration_ms = $7,
           completed_at = now()
       WHERE id = $8`,
      [
        stats.processed,
        stats.completed,
        stats.brandsUpdated,
        stats.cacheHits,
        stats.errors.length,
        JSON.stringify(stats.errors),
        duration,
        runId,
      ]
    );

    console.log(
      `[extract] batch complete in ${duration}ms — ` +
        `${stats.processed} processed, ${stats.completed} completed ` +
        `(${stats.cacheHits} via sha cache), ${stats.failed} failed, ` +
        `${stats.item19RowsUpserted} item19 rows, ${stats.brandsUpdated} brands updated, ` +
        `${stats.remaining} remaining`
    );

    return stats;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE franchise_sync_runs
       SET status = 'failed',
           error_count = 1,
           errors = $1,
           duration_ms = $2,
           completed_at = now()
       WHERE id = $3`,
      [JSON.stringify([{ filing_id: '_global', error: msg }]), duration, runId]
    );
    throw err;
  }
}

async function processOneFiling(
  pool: Pool,
  filing: FilingRow,
  stats: ExtractionStats
): Promise<void> {
  console.log(
    `[extract] (${stats.processed}) ${filing.brandName} ` +
      `${filing.filingState}/${filing.filingYear} (${filing.id})`
  );

  // Cache lookup: same pdf_sha256, already extracted to 'complete'
  if (filing.pdfSha256) {
    const cached = await pool.query<{
      id: string;
      item_5_json: unknown;
      item_6_json: unknown;
      item_7_json: unknown;
      item_19_json: unknown;
      item_20_json: unknown;
    }>(
      `SELECT id, item_5_json, item_6_json, item_7_json, item_19_json, item_20_json
       FROM fdd_filings
       WHERE pdf_sha256 = $1 AND extraction_status = 'complete' AND id <> $2
       ORDER BY extracted_at DESC NULLS LAST
       LIMIT 1`,
      [filing.pdfSha256, filing.id]
    );
    if (cached.rowCount && cached.rowCount > 0) {
      const src = cached.rows[0]!;
      console.log(
        `[extract] sha256 cache hit for ${filing.brandName} — reusing extraction from ${src.id}`
      );
      await persistFromCache(pool, filing, src);
      stats.cacheHits++;
      stats.completed++;
      return;
    }
  }

  // No cache hit — full pipeline.
  const pdfBuffer = await downloadPdfFromGcs(filing.gcsPath);

  const tocResult = await extractToc(pdfBuffer);
  if (!tocResult.toc) {
    stats.skippedNoToc++;
    throw new Error(`TOC extraction failed: ${tocResult.error ?? 'unknown'}`);
  }
  const toc = tocResult.toc;
  console.log(
    `[extract] ${filing.brandName} TOC: pages=${toc.totalPages} ` +
      `5=${toc.item5Page} 6=${toc.item6Page} 7=${toc.item7Page} ` +
      `19=${toc.item19Page}(present=${toc.item19Present}) 20=${toc.item20Page}` +
      (tocResult.modelUsed ? ` via ${tocResult.modelUsed}` : '')
  );

  const [items5_6Res, item7Res, item19Res, item20Res] = await Promise.all([
    extractItem5And6(pdfBuffer, toc),
    extractItem7(pdfBuffer, toc),
    extractItem19(pdfBuffer, toc),
    extractItem20(pdfBuffer, toc),
  ]);

  const item5 = items5_6Res.item5;
  const item6 = items5_6Res.item6;
  const item7 = item7Res.item7;
  const item19 = item19Res.item19;
  const item20 = item20Res.item20;

  if (item19 && !item19.hasItem19) stats.noItem19++;

  // Persist raw JSON on the filing
  await pool.query(
    `UPDATE fdd_filings SET
       extraction_status = 'complete',
       extracted_at = now(),
       extraction_error = NULL,
       item_5_json = $1,
       item_6_json = $2,
       item_7_json = $3,
       item_19_json = $4,
       item_20_json = $5,
       updated_at = now()
     WHERE id = $6`,
    [
      item5 ? JSON.stringify(item5) : null,
      item6 ? JSON.stringify(item6) : null,
      item7 ? JSON.stringify(item7) : null,
      item19 ? JSON.stringify(item19) : null,
      item20 ? JSON.stringify(item20) : null,
      filing.id,
    ]
  );

  // Item 19 facts — one row per metric
  if (item19) {
    const upserted = await upsertItem19Facts(pool, {
      brandId: filing.brandId,
      filingId: filing.id,
      filingYear: filing.filingYear,
      item19,
      extractionConfidence: confidenceFor(item19),
    });
    stats.item19RowsUpserted += upserted;
  }

  // Brand-level economics — most-recent-filing-wins
  const updated = await updateBrandEconomics(pool, {
    brandId: filing.brandId,
    filingId: filing.id,
    filingYear: filing.filingYear,
    item5,
    item6,
    item7,
    item20,
    hasItem19: item19?.hasItem19 ?? false,
  });
  if (updated) stats.brandsUpdated++;

  stats.completed++;
}

async function persistFromCache(
  pool: Pool,
  filing: FilingRow,
  src: {
    id: string;
    item_5_json: unknown;
    item_6_json: unknown;
    item_7_json: unknown;
    item_19_json: unknown;
    item_20_json: unknown;
  }
): Promise<void> {
  const item5 = src.item_5_json as Item5Result | null;
  const item6 = src.item_6_json as Item6Result | null;
  const item7 = src.item_7_json as Item7Result | null;
  const item19 = src.item_19_json as Item19Result | null;
  const item20 = src.item_20_json as Item20Result | null;

  await pool.query(
    `UPDATE fdd_filings SET
       extraction_status = 'complete',
       extracted_at = now(),
       extraction_error = NULL,
       item_5_json = $1,
       item_6_json = $2,
       item_7_json = $3,
       item_19_json = $4,
       item_20_json = $5,
       updated_at = now()
     WHERE id = $6`,
    [
      item5 ? JSON.stringify(item5) : null,
      item6 ? JSON.stringify(item6) : null,
      item7 ? JSON.stringify(item7) : null,
      item19 ? JSON.stringify(item19) : null,
      item20 ? JSON.stringify(item20) : null,
      filing.id,
    ]
  );

  if (item19 && item19.hasItem19) {
    await upsertItem19Facts(pool, {
      brandId: filing.brandId,
      filingId: filing.id,
      filingYear: filing.filingYear,
      item19,
      extractionConfidence: confidenceFor(item19),
    });
  }

  await updateBrandEconomics(pool, {
    brandId: filing.brandId,
    filingId: filing.id,
    filingYear: filing.filingYear,
    item5,
    item6,
    item7,
    item20,
    hasItem19: item19?.hasItem19 ?? false,
  });
}

/** Heuristic confidence: 1.0 if every metric has cohort definition + size,
 *  0.7 if only some, 0.5 if metrics present but no cohort context,
 *  0.0 if no metrics at all. The ETL downstream can use this to decide
 *  whether to surface a metric in the UI vs. flag for human review. */
function confidenceFor(item19: Item19Result): number {
  if (!item19.hasItem19 || item19.metrics.length === 0) return 0;
  const withCohort = item19.metrics.filter((m) => m.cohortDefinition && m.cohortSize).length;
  const ratio = withCohort / item19.metrics.length;
  if (ratio >= 0.9) return 1.0;
  if (ratio >= 0.5) return 0.7;
  return 0.5;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
