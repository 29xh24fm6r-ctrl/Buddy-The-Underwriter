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

/** Normalize a brand/legal/trade name so comparisons survive apostrophe drift,
 *  ® / ™ / ° marks, parenthetical qualifiers, legal-entity suffixes, and
 *  leading "the". Used for tolerant cross-source matching. */
export function normalizeBrand(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase();
  // Strip parenthetical qualifiers: "The UPS Store® (Traditional)" → "The UPS Store®"
  s = s.replace(/\([^)]*\)/g, ' ');
  // Strip trademark/registered/copyright marks
  s = s.replace(/[®©™°]/g, ' ');
  // Strip apostrophes (straight + curly) rather than spacing — "McDonald's" → "mcdonalds"
  s = s.replace(/['’‘`]/g, '');
  // Strip other punctuation to spaces
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  // Drop leading "the "
  s = s.replace(/^the\s+/, '');
  // Drop common legal-entity suffix tokens from the END
  const suffixRe = /\s+(llc|inc|corp|corporation|company|co|ltd|limited|holdings|franchising|franchisor|usa)\b/g;
  // Apply up to 3 times so "McDonalds USA LLC" collapses all the way
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(suffixRe, '').trim();
    if (s === before) break;
  }
  return s;
}

/** Pick the best WI DFI candidate for an SBA brand name.
 *  Returns the chosen result + a one-word reason for the match, or null. */
export function matchWiDfiCandidate(
  sbaBrandName: string,
  candidates: WiDfiSearchResult[]
): { chosen: WiDfiSearchResult; reason: string } | null {
  const current = candidates.filter(
    (r) => r.detailUrl && r.status.toLowerCase() === 'registered'
  );
  if (current.length === 0) return null;

  const want = normalizeBrand(sbaBrandName);
  if (!want) return null;

  const withNormalized = current.map((r) => ({
    r,
    tradeN: normalizeBrand(r.tradeName),
    legalN: normalizeBrand(r.legalName),
  }));

  // 1. Exact normalized match on trade name
  const exact = withNormalized.filter((c) => c.tradeN === want);
  if (exact.length > 0) return pickMostRecent(exact.map((c) => c.r), 'exact_trade');

  // 2. Normalized brand contained in normalized trade (e.g., want="ups store",
  //    trade="ups store traditional")
  const tradeSuper = withNormalized.filter(
    (c) => c.tradeN && c.tradeN.includes(want)
  );
  if (tradeSuper.length > 0) return pickMostRecent(tradeSuper.map((c) => c.r), 'trade_contains_brand');

  // 3. Normalized trade contained in normalized brand (e.g., want="dunkin donuts",
  //    trade="dunkin")
  const brandSuper = withNormalized.filter(
    (c) => c.tradeN && want.includes(c.tradeN) && c.tradeN.length >= 3
  );
  if (brandSuper.length > 0) return pickMostRecent(brandSuper.map((c) => c.r), 'brand_contains_trade');

  // 4. Legal name contains brand tokens (for rows where trade is &nbsp;/blank)
  const legalHit = withNormalized.filter(
    (c) => c.legalN && c.legalN.includes(want)
  );
  if (legalHit.length > 0) return pickMostRecent(legalHit.map((c) => c.r), 'legal_contains_brand');

  return null;
}

function pickMostRecent(
  rows: WiDfiSearchResult[],
  reason: string
): { chosen: WiDfiSearchResult; reason: string } {
  const sorted = rows.slice().sort((a, b) =>
    (b.effectiveDate ?? '').localeCompare(a.effectiveDate ?? '')
  );
  return { chosen: sorted[0]!, reason };
}

/** Compute one retry-variant of a brand name for WI DFI search. WI DFI's
 *  server-side search is leading-prefix-like: "McDonalds" does not match
 *  DB rows stored as "McDonald's" because of the apostrophe, but the
 *  shorter query "McDonald" matches both. And "Dunkin' Donuts" misses the
 *  "Dunkin'" trade name, but "Dunkin" finds it.
 *
 *  Returns null when no useful variant is available. The caller should only
 *  retry when the first search produces zero Registered rows. */
export function queryVariant(original: string): string | null {
  const trimmed = original.trim();

  // Drop leading "The " for multi-word phrases
  const noThe = trimmed.replace(/^the\s+/i, '');
  const words = noThe.split(/\s+/);

  // Multi-word: first word, apostrophes stripped. Must differ from original
  // (case-insensitive) and be >=4 chars to be useful.
  if (words.length >= 2) {
    const firstNoApos = (words[0] ?? '').replace(/['’‘`]/g, '').trim();
    if (
      firstNoApos.length >= 4 &&
      firstNoApos.toLowerCase() !== trimmed.toLowerCase()
    ) {
      return firstNoApos;
    }
  }

  // Single-word purely-alphabetic (with optional apostrophes): strip trailing
  // character to form a prefix. Handles McDonalds → McDonald plural-drop case.
  // Require length >= 7 so we don't over-truncate short names like "Kumon".
  if (/^[A-Za-z'’‘`]+$/.test(trimmed) && trimmed.length >= 7) {
    const noApos = trimmed.replace(/['’‘`]/g, '');
    if (noApos.length >= 6) {
      const truncated = noApos.slice(0, -1);
      if (truncated.toLowerCase() !== trimmed.toLowerCase()) return truncated;
    }
  }
  return null;
}

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
        let results = await searchWiDfi(brand.brand_name);

        // If the first query returned zero Registered rows, retry once with a
        // shorter variant (WI DFI's search is apostrophe/prefix-sensitive).
        const hasRegistered = (rs: WiDfiSearchResult[]) =>
          rs.some((r) => r.detailUrl && r.status.toLowerCase() === 'registered');
        if (!hasRegistered(results)) {
          const variant = queryVariant(brand.brand_name);
          if (variant) {
            await sleep(delayMs);
            console.log(`[wi-fdd] retry variant: "${variant}"`);
            const retryResults = await searchWiDfi(variant);
            if (hasRegistered(retryResults)) {
              results = retryResults; // variant found a Registered row — use it
            }
          }
        }

        if (results.length === 0) {
          stats.skippedNoMatch++;
          console.log(`[wi-fdd] no results for "${brand.brand_name}"`);
          consecutiveErrors = 0;
          continue;
        }

        // Normalized cross-source match: apostrophes, ®, "(Traditional)",
        // legal suffixes all get stripped. Exact → substring → legal-contains.
        const match = matchWiDfiCandidate(brand.brand_name, results);
        if (!match) {
          stats.skippedNoCurrentRegistration++;
          const currentCount = results.filter(
            (r) => r.detailUrl && r.status.toLowerCase() === 'registered'
          ).length;
          console.log(
            `[wi-fdd] "${brand.brand_name}": ${results.length} filings (${currentCount} currently Registered) but no normalized match`
          );
          consecutiveErrors = 0;
          continue;
        }

        stats.matched++;
        const chosen = match.chosen;
        console.log(`[wi-fdd] match_reason=${match.reason}`);

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
