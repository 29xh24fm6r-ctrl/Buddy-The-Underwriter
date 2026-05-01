/**
 * Orchestrator: iterate `franchise_brands` rows that haven't been searched on
 * MN CARDS yet, scrape MN CARDS, upload PDF to GCS, upsert fdd_filings.
 *
 * Pattern mirrors `scrapeWiFdd.ts` — same tracking column convention,
 * same `franchise_sync_runs` audit trail, same brand-name normalization
 * via `normalizeBrand` and apostrophe-variant retry via `queryVariant`.
 *
 * MN-specific quirks:
 * - The CARDS server requires a year. We probe currentYear, currentYear-1,
 *   and currentYear-2 in turn (most franchises file annually but registration
 *   timing slips). Stop at the first year that yields an FDD-typed document.
 * - We mark `mn_cards_searched_at = now()` after EVERY brand (match,
 *   no-match, or error) so a re-run picks up where we left off.
 */

import type { Pool } from 'pg';
import {
  searchMnCards,
  pickBestFdd,
  downloadMnFddPdf,
  filterToFddDocs,
  type MnCardsSearchResult,
} from './mnCardsScraper.js';
import { normalizeBrand, queryVariant } from './scrapeWiFdd.js';
import { uploadFddToGcs, estimatePageCount } from './gcsUploader.js';

export interface ScrapeMnOptions {
  batchSize?: number;
  delayMs?: number;
  maxErrors?: number;
  downloadPdf?: boolean;
  /** ILIKE pattern (supports %). Useful for piloting against known brands. */
  brandFilter?: string;
  /** Number of past calendar years to probe per brand. Default 3 — covers
   *  the typical annual-renewal cadence with one year of slack. */
  yearLookback?: number;
}

export interface ScrapeMnStats {
  processed: number;
  matched: number;            // had at least one FDD-typed row in CARDS
  pickedYear: Record<string, number>; // brand -> the year that yielded the FDD
  downloaded: number;
  uploaded: number;
  filingsUpserted: number;
  skippedNoMatch: number;     // search returned zero rows for any year
  skippedNoFddRow: number;    // had results but none were FDD docs
  skippedNoNameMatch: number; // had FDD rows but none matched brand name
  errors: Array<{ brand_name: string; error: string }>;
  remaining: number;
  runId: string;
}

export async function scrapeMnFddBatch(
  pool: Pool,
  options: ScrapeMnOptions = {}
): Promise<ScrapeMnStats> {
  const batchSize = options.batchSize ?? 50;
  const delayMs = options.delayMs ?? 2500;
  const maxErrors = options.maxErrors ?? 10;
  const downloadPdf = options.downloadPdf ?? true;
  const yearLookback = Math.max(1, options.yearLookback ?? 3);

  const currentYear = new Date().getFullYear();
  const yearsToProbe = Array.from({ length: yearLookback }, (_, i) => currentYear - i);

  const stats: ScrapeMnStats = {
    processed: 0,
    matched: 0,
    pickedYear: {},
    downloaded: 0,
    uploaded: 0,
    filingsUpserted: 0,
    skippedNoMatch: 0,
    skippedNoFddRow: 0,
    skippedNoNameMatch: 0,
    errors: [],
    remaining: 0,
    runId: '',
  };

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO franchise_sync_runs (source, status)
     VALUES ('state_mn', 'running')
     RETURNING id`
  );
  const runId = runRes.rows[0]!.id;
  stats.runId = runId;
  const startTime = Date.now();

  try {
    const filterClause = options.brandFilter ? 'AND fb.brand_name ILIKE $2' : '';
    const filterParams = options.brandFilter
      ? [batchSize, options.brandFilter]
      : [batchSize];

    const brandsRes = await pool.query<{ id: string; brand_name: string }>(
      `SELECT fb.id, fb.brand_name
       FROM franchise_brands fb
       WHERE fb.canonical = true
         AND fb.sba_eligible = true
         AND fb.mn_cards_searched_at IS NULL
         ${filterClause}
       ORDER BY fb.brand_name
       LIMIT $1`,
      filterParams
    );

    const remainingRes = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM franchise_brands fb
       WHERE fb.canonical = true
         AND fb.sba_eligible = true
         AND fb.mn_cards_searched_at IS NULL
         ${options.brandFilter ? 'AND fb.brand_name ILIKE $1' : ''}`,
      options.brandFilter ? [options.brandFilter] : []
    );
    stats.remaining = parseInt(remainingRes.rows[0]?.count ?? '0', 10);

    let consecutiveErrors = 0;

    for (const brand of brandsRes.rows) {
      if (consecutiveErrors >= maxErrors) {
        console.log(
          `[mn-fdd] aborting: ${maxErrors} consecutive errors — check MN CARDS availability`
        );
        break;
      }

      stats.processed++;

      try {
        if (stats.processed > 1) await sleep(delayMs);

        console.log(
          `[mn-fdd] (${stats.processed}/${brandsRes.rows.length}) searching: ${brand.brand_name}`
        );

        // Year-lookback loop: try most recent year first, stop on first
        // year that yields an FDD-typed row.
        const allResults: MnCardsSearchResult[] = [];
        let pickedYear: number | null = null;

        for (const year of yearsToProbe) {
          if (allResults.length > 0 && pickedYear !== null) break;

          // First try the brand name as-is.
          let yearResults = await withMnRetryOn429(() =>
            searchMnCards({ franchiseName: brand.brand_name, year })
          );

          // No FDD-typed row? Try an apostrophe-stripped / shortened variant
          // (same heuristic as WI DFI — cheap retry, server-side substring
          // match plays badly with apostrophes for some brands).
          if (filterToFddDocs(yearResults).length === 0) {
            const variant = queryVariant(brand.brand_name);
            if (variant) {
              await sleep(delayMs);
              console.log(`[mn-fdd] retry variant: "${variant}" (year=${year})`);
              const variantResults = await withMnRetryOn429(() =>
                searchMnCards({ franchiseName: variant, year })
              );
              if (filterToFddDocs(variantResults).length > 0) {
                yearResults = variantResults;
              }
            }
          }

          if (filterToFddDocs(yearResults).length > 0) {
            pickedYear = year;
            allResults.push(...yearResults);
            break;
          }

          // Pace year-by-year requests
          if (year !== yearsToProbe[yearsToProbe.length - 1]) {
            await sleep(delayMs);
          }
        }

        if (allResults.length === 0) {
          stats.skippedNoMatch++;
          console.log(`[mn-fdd] no results for "${brand.brand_name}" across ${yearsToProbe.join(',')}`);
          consecutiveErrors = 0;
          await pool.query(
            'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        // Cross-source name match — normalize via shared `normalizeBrand`
        // so apostrophe / suffix / parenthetical drift doesn't kill matches.
        const wantNorm = normalizeBrand(brand.brand_name);
        const fddRows = filterToFddDocs(allResults);
        if (fddRows.length === 0) {
          stats.skippedNoFddRow++;
          console.log(
            `[mn-fdd] "${brand.brand_name}": ${allResults.length} rows but none are FDD type`
          );
          consecutiveErrors = 0;
          await pool.query(
            'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        const nameMatched = fddRows.filter((r) => {
          const fNorm = normalizeBrand(r.franchiseName);
          const lNorm = normalizeBrand(r.franchisor);
          if (!wantNorm) return false;
          return (
            fNorm === wantNorm ||
            (fNorm && fNorm.includes(wantNorm)) ||
            (wantNorm && fNorm && wantNorm.includes(fNorm) && fNorm.length >= 3) ||
            (lNorm && lNorm.includes(wantNorm))
          );
        });

        if (nameMatched.length === 0) {
          stats.skippedNoNameMatch++;
          console.log(
            `[mn-fdd] "${brand.brand_name}": ${fddRows.length} FDD rows but no normalized name match`
          );
          consecutiveErrors = 0;
          await pool.query(
            'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        const chosen = pickBestFdd(nameMatched);
        if (!chosen) {
          // Should never happen — pickBestFdd returns null only on empty input.
          stats.skippedNoFddRow++;
          await pool.query(
            'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        stats.matched++;
        stats.pickedYear[brand.brand_name] = pickedYear ?? chosen.year ?? currentYear;
        console.log(
          `[mn-fdd] matched: ${chosen.franchisor} / ${chosen.franchiseName} ` +
            `(${chosen.documentType}, year=${chosen.year}, file=${chosen.fileNumber}, eff=${chosen.effectiveDate})`
        );

        const filingYear = chosen.year ?? pickedYear ?? currentYear;

        let gcsPath: string | null = null;
        let pdfSha256: string | null = null;
        let pageCount: number | null = null;
        let extractionStatus = 'skipped';

        if (downloadPdf) {
          await sleep(delayMs);
          try {
            const pdf = await withMnRetryOn429(() => downloadMnFddPdf(chosen.downloadUrl));
            stats.downloaded++;

            const upload = await uploadFddToGcs(pdf, {
              brandName: brand.brand_name,
              filingYear,
              filingState: 'MN',
              fileNumber: chosen.fileNumber,
            });
            pdfSha256 = upload.sha256;
            gcsPath = upload.gcsPath;
            pageCount = estimatePageCount(pdf);

            if (upload.status === 'uploaded' || upload.status === 'already_exists') {
              stats.uploaded++;
              extractionStatus = 'pending';
            } else if (upload.status === 'skipped') {
              extractionStatus = 'skipped';
              console.log(
                `[mn-fdd] GCS_BUCKET not set — PDF fetched (sha=${pdfSha256.slice(0, 12)}, ${pdf.length} bytes) but not persisted`
              );
            } else {
              extractionStatus = 'failed';
              console.error(`[mn-fdd] GCS upload failed for ${brand.brand_name}: ${upload.error}`);
            }
          } catch (pdfErr) {
            const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
            console.error(`[mn-fdd] PDF download failed for ${brand.brand_name}: ${msg}`);
            extractionStatus = 'failed';
          }
        }

        await pool.query(
          `INSERT INTO fdd_filings
             (brand_id, filing_state, filing_year, effective_date, expiration_date,
              gcs_path, pdf_sha256, page_count, extraction_status, source)
           VALUES ($1, 'MN', $2, $3, NULL, $4, $5, $6, $7, 'state_mn')
           ON CONFLICT (brand_id, filing_state, filing_year)
           DO UPDATE SET
             effective_date = EXCLUDED.effective_date,
             gcs_path = COALESCE(EXCLUDED.gcs_path, fdd_filings.gcs_path),
             pdf_sha256 = COALESCE(EXCLUDED.pdf_sha256, fdd_filings.pdf_sha256),
             page_count = COALESCE(EXCLUDED.page_count, fdd_filings.page_count),
             extraction_status = EXCLUDED.extraction_status,
             updated_at = now()`,
          [
            brand.id,
            filingYear,
            chosen.effectiveDate ?? chosen.filedDate,
            gcsPath,
            pdfSha256,
            pageCount,
            extractionStatus,
          ]
        );
        stats.filingsUpserted++;
        await pool.query(
          'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
          [brand.id]
        );
        consecutiveErrors = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 429s are handled with backoff inside withMnRetryOn429. If we still
        // see one here, the helper has exhausted its retries — record the
        // error but don't count it toward the consecutive-error abort, since
        // the cause is server-side rate limiting, not our code or MN being
        // unavailable.
        const isExhausted429 = /returned\s+429/i.test(msg);
        if (!isExhausted429) consecutiveErrors++;
        stats.errors.push({ brand_name: brand.brand_name, error: msg });
        console.error(`[mn-fdd] error for ${brand.brand_name}: ${msg}`);
        try {
          await pool.query(
            'UPDATE franchise_brands SET mn_cards_searched_at = now() WHERE id = $1',
            [brand.id]
          );
        } catch (markErr) {
          const markMsg = markErr instanceof Error ? markErr.message : String(markErr);
          console.error(`[mn-fdd] failed to mark searched_at for ${brand.brand_name}: ${markMsg}`);
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
        stats.filingsUpserted,
        stats.uploaded,
        stats.skippedNoMatch + stats.skippedNoFddRow + stats.skippedNoNameMatch,
        stats.errors.length,
        JSON.stringify(stats.errors),
        duration,
        runId,
      ]
    );

    console.log(
      `[mn-fdd] batch complete in ${duration}ms — ` +
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

/** MN CARDS returns HTTP 429 in bursts when the scraper outpaces the
 *  server's rate window. Treat 429 as recoverable: sleep with exponential
 *  backoff (30s, 60s, 120s) and retry up to 3 times. Any other error
 *  propagates immediately. After all retries fail, the original 429 error
 *  is rethrown — the caller's outer catch is expected to detect this and
 *  skip incrementing the consecutive-error counter. */
async function withMnRetryOn429<T>(operation: () => Promise<T>): Promise<T> {
  const MAX_RETRIES = 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/returned\s+429/i.test(msg)) throw err;
      if (attempt === MAX_RETRIES) break;
      const sleepMs = 30_000 * 2 ** attempt; // 30s, 60s, 120s
      console.log(
        `[mn-fdd] 429 backoff: sleeping ${sleepMs}ms before retry ${attempt + 1}/${MAX_RETRIES}`
      );
      await sleep(sleepMs);
    }
  }
  throw lastErr;
}
