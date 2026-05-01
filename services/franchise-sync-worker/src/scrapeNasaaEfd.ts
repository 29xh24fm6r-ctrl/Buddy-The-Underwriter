/**
 * Orchestrator: iterate `franchise_brands` rows that haven't been searched
 * on NASAA EFD yet, scrape NASAA EFD, upload PDFs to GCS, upsert
 * `fdd_filings` rows. Pattern mirrors `scrapeMnFdd.ts`.
 *
 * NASAA-specific quirks:
 * - Each brand can have multiple EFDID hits (one "Registrations" entity
 *   plus one or more "Exemption by Order" variants). We walk every hit
 *   and process each registration row inside it.
 * - The `filing_state` for each fdd_filings row comes from the per-row
 *   state in the detail table, NOT the source itself. Source is fixed at
 *   `nasaa_efd`. A single brand can therefore generate filings for many
 *   states off a single search.
 * - To stay under DB unique constraint (brand_id, filing_state,
 *   filing_year), when a brand-state has multiple registration rows
 *   across years we process the most recent eff_start_date only.
 */

import type { Pool } from 'pg';
import {
  searchNasaaEfd,
  getBrandDetail,
  getRegistrationDocuments,
  pickFddDocument,
  downloadNasaaEfdPdf,
  stateAbbrev,
  type NasaaSearchHit,
  type NasaaRegistrationRow,
} from './nasaaEfdScraper.js';
import { normalizeBrand, queryVariant } from './scrapeWiFdd.js';
import { uploadFddToGcs, estimatePageCount } from './gcsUploader.js';

export interface ScrapeNasaaOptions {
  batchSize?: number;
  delayMs?: number;
  maxErrors?: number;
  downloadPdf?: boolean;
  /** ILIKE pattern (supports %). Useful for piloting against known brands. */
  brandFilter?: string;
}

export interface ScrapeNasaaStats {
  processed: number;
  brandsMatched: number;        // had at least one normalized-name-matched EFDID
  hitsExamined: number;         // total EFDID detail pages fetched
  registrationRowsSeen: number; // total state-rows across all detail tables
  filingsAttempted: number;     // (brand, state, year) combos picked for download
  downloaded: number;           // PDFs fetched from NASAA EFD
  uploaded: number;             // PDFs landed in GCS
  filingsUpserted: number;      // rows written to fdd_filings
  skippedNoMatch: number;       // search returned zero EFDID hits
  skippedNoNameMatch: number;   // hits returned but none normalized-matched
  skippedNoFdd: number;         // a registration had no public FDD on its notice page
  errors: Array<{ brand_name: string; error: string }>;
  remaining: number;
  runId: string;
  /** state -> count of fdd_filings upserted */
  filingsByState: Record<string, number>;
}

const SUPPORTED_STATES = new Set([
  'AL', 'AK', 'CO', 'DE', 'DC', 'FL', 'GA', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'MD', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'ND', 'OH', 'OK', 'OR', 'PA', 'PR', 'RI', 'SC', 'SD', 'TX', 'VT',
  'VI', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

export async function scrapeNasaaEfdBatch(
  pool: Pool,
  options: ScrapeNasaaOptions = {}
): Promise<ScrapeNasaaStats> {
  const batchSize = options.batchSize ?? 50;
  const delayMs = options.delayMs ?? 3000;
  const maxErrors = options.maxErrors ?? 10;
  const downloadPdf = options.downloadPdf ?? true;
  const currentYear = new Date().getFullYear();

  const stats: ScrapeNasaaStats = {
    processed: 0,
    brandsMatched: 0,
    hitsExamined: 0,
    registrationRowsSeen: 0,
    filingsAttempted: 0,
    downloaded: 0,
    uploaded: 0,
    filingsUpserted: 0,
    skippedNoMatch: 0,
    skippedNoNameMatch: 0,
    skippedNoFdd: 0,
    errors: [],
    remaining: 0,
    runId: '',
    filingsByState: {},
  };

  const runRes = await pool.query<{ id: string }>(
    `INSERT INTO franchise_sync_runs (source, status)
     VALUES ('nasaa_efd', 'running')
     RETURNING id`
  );
  const runId = runRes.rows[0]!.id;
  stats.runId = runId;
  const startTime = Date.now();

  try {
    const filterClause = options.brandFilter ? 'AND fb.brand_name ILIKE $2' : '';
    const filterParams: Array<string | number> = options.brandFilter
      ? [batchSize, options.brandFilter]
      : [batchSize];

    const brandsRes = await pool.query<{ id: string; brand_name: string }>(
      `SELECT fb.id, fb.brand_name
       FROM franchise_brands fb
       WHERE fb.canonical = true
         AND fb.sba_eligible = true
         AND fb.nasaa_efd_searched_at IS NULL
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
         AND fb.nasaa_efd_searched_at IS NULL
         ${options.brandFilter ? 'AND fb.brand_name ILIKE $1' : ''}`,
      options.brandFilter ? [options.brandFilter] : []
    );
    stats.remaining = parseInt(remainingRes.rows[0]?.count ?? '0', 10);

    let consecutiveErrors = 0;

    for (const brand of brandsRes.rows) {
      if (consecutiveErrors >= maxErrors) {
        console.log(
          `[nasaa-efd] aborting: ${maxErrors} consecutive errors — check NASAA EFD availability`
        );
        break;
      }

      stats.processed++;

      try {
        if (stats.processed > 1) await sleep(delayMs);

        console.log(
          `[nasaa-efd] (${stats.processed}/${brandsRes.rows.length}) searching: ${brand.brand_name}`
        );

        let hits = await searchNasaaEfd(brand.brand_name);

        if (hits.length === 0) {
          // Same apostrophe/prefix retry as WI/MN — the NASAA server-side
          // substring match plays poorly with apostrophes and trade-name
          // suffixes for some brands.
          const variant = queryVariant(brand.brand_name);
          if (variant) {
            await sleep(delayMs);
            console.log(`[nasaa-efd] retry variant: "${variant}"`);
            hits = await searchNasaaEfd(variant);
          }
        }

        if (hits.length === 0) {
          stats.skippedNoMatch++;
          console.log(`[nasaa-efd] no results for "${brand.brand_name}"`);
          consecutiveErrors = 0;
          await pool.query(
            'UPDATE franchise_brands SET nasaa_efd_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        // Normalized cross-source match: keep hits whose franchisor or
        // brand strings overlap with the canonical brand name. Same
        // tolerance as WI/MN matching.
        const wantNorm = normalizeBrand(brand.brand_name);
        const matchedHits = hits.filter((h) => nameMatches(wantNorm, h));
        if (matchedHits.length === 0) {
          stats.skippedNoNameMatch++;
          console.log(
            `[nasaa-efd] "${brand.brand_name}": ${hits.length} hits but no normalized match`
          );
          consecutiveErrors = 0;
          await pool.query(
            'UPDATE franchise_brands SET nasaa_efd_searched_at = now() WHERE id = $1',
            [brand.id]
          );
          continue;
        }

        stats.brandsMatched++;
        console.log(
          `[nasaa-efd] "${brand.brand_name}": ${matchedHits.length} matched hit(s) of ${hits.length}`
        );

        // Walk every matched EFDID hit and process all of its
        // registration rows. Per-(state, year) dedup happens at the
        // fdd_filings unique key.
        const seenStateYear = new Set<string>();
        for (const hit of matchedHits) {
          await sleep(delayMs);
          stats.hitsExamined++;

          let regRows: NasaaRegistrationRow[];
          try {
            regRows = await getBrandDetail(hit.detailUrl);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[nasaa-efd] detail fetch failed for ${hit.efdid}: ${msg}`);
            continue;
          }
          stats.registrationRowsSeen += regRows.length;
          if (regRows.length === 0) {
            console.log(`[nasaa-efd] EFDID ${hit.efdid}: detail page had 0 rows`);
            continue;
          }

          // Pick the most-recent registration row per state (by eff_start)
          const bestPerState = pickMostRecentPerState(regRows);

          for (const reg of bestPerState) {
            const stAbbrev = stateAbbrev(reg.state);
            if (!stAbbrev || !SUPPORTED_STATES.has(stAbbrev)) {
              console.log(
                `[nasaa-efd] EFDID ${hit.efdid}: skipping unrecognized state "${reg.state}"`
              );
              continue;
            }
            const filingYear = reg.effectiveStartDate
              ? parseInt(reg.effectiveStartDate.slice(0, 4), 10)
              : currentYear;
            const stateYearKey = `${stAbbrev}:${filingYear}`;
            if (seenStateYear.has(stateYearKey)) continue;
            seenStateYear.add(stateYearKey);

            stats.filingsAttempted++;
            await sleep(delayMs);

            let fddDoc;
            try {
              const docs = await getRegistrationDocuments(reg.noticesUrl);
              fddDoc = pickFddDocument(docs);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(
                `[nasaa-efd] notices fetch failed for EFDID=${hit.efdid} regId=${reg.registrationId}: ${msg}`
              );
              continue;
            }

            if (!fddDoc || !fddDoc.downloadUrl) {
              stats.skippedNoFdd++;
              console.log(
                `[nasaa-efd] EFDID=${hit.efdid} regId=${reg.registrationId} state=${stAbbrev} year=${filingYear}: no public FDD doc`
              );
              continue;
            }

            let gcsPath: string | null = null;
            let pdfSha256: string | null = null;
            let pageCount: number | null = null;
            let extractionStatus = 'skipped';

            if (downloadPdf) {
              await sleep(delayMs);
              try {
                const pdf = await downloadNasaaEfdPdf(fddDoc.downloadUrl);
                stats.downloaded++;
                const upload = await uploadFddToGcs(pdf, {
                  brandName: brand.brand_name,
                  filingYear,
                  filingState: stAbbrev,
                  fileNumber: reg.stateFileNumber,
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
                    `[nasaa-efd] GCS_BUCKET not set — PDF fetched (sha=${pdfSha256.slice(0, 12)}, ${pdf.length} bytes) but not persisted`
                  );
                } else {
                  extractionStatus = 'failed';
                  console.error(`[nasaa-efd] GCS upload failed: ${upload.error}`);
                }
              } catch (pdfErr) {
                const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
                console.error(
                  `[nasaa-efd] PDF download failed (EFDID=${hit.efdid} regId=${reg.registrationId}): ${msg}`
                );
                extractionStatus = 'failed';
              }
            }

            await pool.query(
              `INSERT INTO fdd_filings
                 (brand_id, filing_state, filing_year, effective_date, expiration_date,
                  gcs_path, pdf_sha256, page_count, extraction_status, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'nasaa_efd')
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
                stAbbrev,
                filingYear,
                reg.effectiveStartDate,
                reg.effectiveEndDate,
                gcsPath,
                pdfSha256,
                pageCount,
                extractionStatus,
              ]
            );
            stats.filingsUpserted++;
            stats.filingsByState[stAbbrev] = (stats.filingsByState[stAbbrev] ?? 0) + 1;

            console.log(
              `[nasaa-efd] upserted: brand=${brand.brand_name} state=${stAbbrev} year=${filingYear} ` +
                `eff=${reg.effectiveStartDate ?? 'n/a'} status=${extractionStatus}`
            );
          }
        }

        await pool.query(
          'UPDATE franchise_brands SET nasaa_efd_searched_at = now() WHERE id = $1',
          [brand.id]
        );
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ brand_name: brand.brand_name, error: msg });
        console.error(`[nasaa-efd] error for ${brand.brand_name}: ${msg}`);
        try {
          await pool.query(
            'UPDATE franchise_brands SET nasaa_efd_searched_at = now() WHERE id = $1',
            [brand.id]
          );
        } catch (markErr) {
          const markMsg = markErr instanceof Error ? markErr.message : String(markErr);
          console.error(`[nasaa-efd] failed to mark searched_at: ${markMsg}`);
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
        stats.skippedNoMatch + stats.skippedNoNameMatch,
        stats.errors.length,
        JSON.stringify(stats.errors),
        duration,
        runId,
      ]
    );

    console.log(
      `[nasaa-efd] batch complete in ${duration}ms — ` +
        `${stats.processed} processed, ${stats.brandsMatched} matched, ` +
        `${stats.filingsAttempted} filings attempted, ${stats.uploaded} uploaded, ` +
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

function nameMatches(wantNorm: string, hit: NasaaSearchHit): boolean {
  if (!wantNorm) return false;
  const candidates = [hit.brand, hit.franchisor, hit.businessName]
    .map(normalizeBrand)
    .filter(Boolean);
  for (const c of candidates) {
    if (c === wantNorm) return true;
    if (c.includes(wantNorm)) return true;
    if (wantNorm.includes(c) && c.length >= 3) return true;
  }
  return false;
}

function pickMostRecentPerState(rows: NasaaRegistrationRow[]): NasaaRegistrationRow[] {
  const best = new Map<string, NasaaRegistrationRow>();
  for (const r of rows) {
    const key = r.state;
    const prev = best.get(key);
    if (!prev) {
      best.set(key, r);
      continue;
    }
    const a = r.effectiveStartDate ?? '';
    const b = prev.effectiveStartDate ?? '';
    if (a.localeCompare(b) > 0) best.set(key, r);
  }
  return Array.from(best.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
