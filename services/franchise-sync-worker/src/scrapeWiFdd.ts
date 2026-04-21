/**
 * Orchestrator: iterate `franchise_brands` rows without a recent WI fdd_filings row,
 * scrape WI DFI, optionally upload PDF to GCS, upsert fdd_filings.
 *
 * Resumable: SKIP brands with an existing WI filing in the last 2 filing years
 * (registrations are annual, so re-scraping within a year is wasteful).
 */

import type { Pool } from 'pg';
import {
  searchWiDfi,
  getFilingDetail,
  downloadFddPdf,
  type WiDfiSearchResult,
} from './wiDfiScraper.js';
import { uploadFddToGcs, estimatePageCount } from './gcsUploader.js';

export interface ScrapeOptions {
  batchSize?: number;
  delayMs?: number;
  maxErrors?: number;
  downloadPdf?: boolean; // default true; set false to only persist metadata
  /** ILIKE pattern (supports %). If set, only brands matching this pattern
   *  are candidates. Useful for piloting against known-registered brands. */
  brandFilter?: string;
}

export interface ScrapeStats {
  processed: number;
  matched: number;        // brand name matched at least one Registered filing
  detailFetched: number;
  downloaded: number;     // PDFs actually fetched from WI DFI
  uploaded: number;       // PDFs landed in GCS
  filingsUpserted: number;
  skippedNoMatch: number;
  skippedNoCurrentRegistration: number;
  errors: Array<{ brand_name: string; error: string }>;
  remaining: number;      // brands still needing scrape
  runId: string;
}

export async function scrapeWiFddBatch(
  pool: Pool,
  options: ScrapeOptions = {}
): Promise<ScrapeStats> {
  const batchSize = options.batchSize ?? 50;
  const delayMs = options.delayMs ?? 2000;
  const maxErrors = options.maxErrors ?? 10;
  const downloadPdf = options.downloadPdf ?? true;
  const currentYear = new Date().getFullYear();
  // Annual registrations — a filing for this year OR last year counts as fresh
  const minRecentYear = currentYear - 1;

  const stats: ScrapeStats = {
    processed: 0,
    matched: 0,
    detailFetched: 0,
    downloaded: 0,
    uploaded: 0,
    filingsUpserted: 0,
    skippedNoMatch: 0,
    skippedNoCurrentRegistration: 0,
    errors: [],
    remaining: 0,
    runId: '',
  };

  // Create sync run
  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO franchise_sync_runs (source, status)
     VALUES ('state_wi', 'running')
     RETURNING id`
  );
  const runId = runRes.rows[0]!.id;
  stats.runId = runId;
  const startTime = Date.now();

  try {
    const filterClause = options.brandFilter
      ? 'AND fb.brand_name ILIKE $3'
      : '';
    const filterParams = options.brandFilter
      ? [minRecentYear, batchSize, options.brandFilter]
      : [minRecentYear, batchSize];

    // Find brands needing a WI scrape (no fdd_filing for WI in recent years)
    const brandsRes = await pool.query<{ id: string; brand_name: string }>(
      `SELECT fb.id, fb.brand_name
       FROM franchise_brands fb
       WHERE fb.canonical = true
         AND fb.sba_eligible = true
         AND NOT EXISTS (
           SELECT 1 FROM fdd_filings ff
           WHERE ff.brand_id = fb.id
             AND ff.filing_state = 'WI'
             AND ff.filing_year >= $1
         )
         ${filterClause}
       ORDER BY fb.brand_name
       LIMIT $2`,
      filterParams
    );

    const remainingRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM franchise_brands fb
       WHERE fb.canonical = true
         AND fb.sba_eligible = true
         AND NOT EXISTS (
           SELECT 1 FROM fdd_filings ff
           WHERE ff.brand_id = fb.id
             AND ff.filing_state = 'WI'
             AND ff.filing_year >= $1
         )
         ${options.brandFilter ? 'AND fb.brand_name ILIKE $2' : ''}`,
      options.brandFilter ? [minRecentYear, options.brandFilter] : [minRecentYear]
    );
    stats.remaining = parseInt(remainingRes.rows[0]?.count ?? '0', 10);

    let consecutiveErrors = 0;

    for (const brand of brandsRes.rows) {
      if (consecutiveErrors >= maxErrors) {
        console.log(
          `[wi-fdd] aborting: ${maxErrors} consecutive errors — check WI DFI availability`
        );
        break;
      }

      stats.processed++;

      try {
        if (stats.processed > 1) await sleep(delayMs);

        console.log(`[wi-fdd] (${stats.processed}/${brandsRes.rows.length}) searching: ${brand.brand_name}`);
        const results = await searchWiDfi(brand.brand_name);

        // Match on TRADE NAME (column 3) case-insensitively. WI DFI stores
        // the SBA-familiar brand name in trade name; legal name is e.g.
        // "DOCTOR'S ASSOCIATES LLC" vs trade name "Subway".
        const target = brand.brand_name.trim().toLowerCase();
        const byTrade = results.filter(
          (r) => r.tradeName.toLowerCase() === target
        );
        const candidates = byTrade.length > 0 ? byTrade : results;

        // Only rows with a clickable Details link are current/registered
        const current = candidates.filter(
          (r) => r.detailUrl && r.status.toLowerCase() === 'registered'
        );

        if (results.length === 0) {
          stats.skippedNoMatch++;
          console.log(`[wi-fdd] no results for "${brand.brand_name}"`);
          consecutiveErrors = 0;
          continue;
        }

        if (current.length === 0) {
          stats.skippedNoCurrentRegistration++;
          console.log(
            `[wi-fdd] "${brand.brand_name}" has ${results.length} historical filings but no current Registered (all expired)`
          );
          consecutiveErrors = 0;
          continue;
        }

        stats.matched++;
        // Pick the most recent effective date
        const sorted = current.slice().sort((a, b) =>
          (b.effectiveDate ?? '').localeCompare(a.effectiveDate ?? '')
        );
        const chosen = sorted[0]!;

        // Rate limit between search and detail fetch
        await sleep(delayMs);

        console.log(
          `[wi-fdd] matched: ${chosen.legalName} / ${chosen.tradeName} (file ${chosen.fileNumber}, eff ${chosen.effectiveDate})`
        );
        const detail = await getFilingDetail(chosen.detailUrl!);
        stats.detailFetched++;

        // Decide filing year from effective date
        const filingYear = chosen.effectiveDate
          ? parseInt(chosen.effectiveDate.slice(0, 4), 10)
          : currentYear;

        // Download PDF if available and requested
        let gcsPath: string | null = null;
        let pdfSha256: string | null = null;
        let pageCount: number | null = null;
        let extractionStatus = 'skipped';

        if (downloadPdf && detail.hasFddPdf) {
          await sleep(delayMs);
          try {
            const pdf = await downloadFddPdf(chosen.detailUrl!, detail.viewstateFields);
            stats.downloaded++;

            const upload = await uploadFddToGcs(pdf, {
              brandName: brand.brand_name,
              filingYear,
              filingState: 'WI',
              fileNumber: chosen.fileNumber,
            });
            pdfSha256 = upload.sha256;
            gcsPath = upload.gcsPath;
            pageCount = estimatePageCount(pdf);

            if (upload.status === 'uploaded' || upload.status === 'already_exists') {
              stats.uploaded++;
              extractionStatus = 'pending'; // ready for Slice 3
            } else if (upload.status === 'skipped') {
              extractionStatus = 'skipped'; // GCS_BUCKET not set
              console.log(
                `[wi-fdd] GCS_BUCKET not set — PDF fetched (sha=${pdfSha256.slice(0, 12)}, ${pdf.length} bytes) but not persisted`
              );
            } else {
              extractionStatus = 'failed';
              console.error(`[wi-fdd] GCS upload failed for ${brand.brand_name}: ${upload.error}`);
            }
          } catch (pdfErr) {
            const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
            console.error(`[wi-fdd] PDF download failed for ${brand.brand_name}: ${msg}`);
            extractionStatus = 'failed';
          }
        } else if (!detail.hasFddPdf) {
          console.log(`[wi-fdd] ${brand.brand_name}: no FDD PDF attached on detail page`);
        }

        // Upsert fdd_filings row
        await pool.query(
          `INSERT INTO fdd_filings
             (brand_id, filing_state, filing_year, effective_date, expiration_date,
              gcs_path, pdf_sha256, page_count, extraction_status, source)
           VALUES ($1, 'WI', $2, $3, $4, $5, $6, $7, $8, 'state_wi')
           ON CONFLICT (brand_id, filing_state, filing_year)
           DO UPDATE SET
             effective_date = EXCLUDED.effective_date,
             expiration_date = EXCLUDED.expiration_date,
             gcs_path = COALESCE(EXCLUDED.gcs_path, fdd_filings.gcs_path),
             pdf_sha256 = COALESCE(EXCLUDED.pdf_sha256, fdd_filings.pdf_sha256),
             page_count = COALESCE(EXCLUDED.page_count, fdd_filings.page_count),
             extraction_status = EXCLUDED.extraction_status,
             updated_at = now()`,
          [
            brand.id,
            filingYear,
            chosen.effectiveDate,
            chosen.expirationDate,
            gcsPath,
            pdfSha256,
            pageCount,
            extractionStatus,
          ]
        );
        stats.filingsUpserted++;
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ brand_name: brand.brand_name, error: msg });
        console.error(`[wi-fdd] error for ${brand.brand_name}: ${msg}`);
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
        stats.filingsUpserted,
        stats.uploaded,
        stats.skippedNoMatch + stats.skippedNoCurrentRegistration,
        stats.errors.length,
        JSON.stringify(stats.errors),
        duration,
        runId,
      ]
    );

    console.log(
      `[wi-fdd] batch complete in ${duration}ms — ` +
        `${stats.processed} processed, ${stats.matched} matched, ` +
        `${stats.downloaded} downloaded, ${stats.uploaded} uploaded, ` +
        `${stats.filingsUpserted} filings upserted, ${stats.errors.length} errors, ` +
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
      [JSON.stringify([{ brand_name: '_global', error: msg }]), duration, runId]
    );
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
