import type { Pool } from 'pg';
import { parseSbaDirectoryXlsx, hashRow } from './xlsxParser.js';
import { computeDiff } from './diffEngine.js';
import type { SyncRunStats, SbaDirectoryRow } from './types.js';

const SBA_DIRECTORY_PAGE =
  'https://www.sba.gov/document/support-sba-franchise-directory';

/** Chunk size for batched INSERTs. 500 × 10 params = 5000 params/statement, well
 *  under Postgres' 65,535 bind-parameter limit. Tunable via BATCH_SIZE env. */
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);

/** Scrape the SBA directory page to find the current .xlsx download link */
async function discoverXlsxUrl(): Promise<string> {
  console.log(`[franchise-sync] fetching directory page: ${SBA_DIRECTORY_PAGE}`);
  const response = await fetch(SBA_DIRECTORY_PAGE);
  if (!response.ok) {
    throw new Error(`Failed to fetch SBA directory page: ${response.status}`);
  }
  const html = await response.text();

  // The download link is an <a> tag with href ending in .xlsx
  // Example: href="/sites/default/files/2026-04/Franchise%20Directory%20Apr%2017%202026.xlsx"
  const match = html.match(/href="([^"]*\.xlsx)"/i);
  if (!match || !match[1]) {
    throw new Error(
      'Could not find .xlsx download link on SBA directory page. ' +
        'The page structure may have changed.'
    );
  }

  let url = match[1];
  if (url.startsWith('/')) {
    url = `https://www.sba.gov${url}`;
  }

  console.log(`[franchise-sync] discovered xlsx URL: ${url}`);
  return url;
}

export async function syncSbaDirectory(pool: Pool): Promise<SyncRunStats> {
  const stats: SyncRunStats = {
    total_rows_in_source: 0,
    brands_added: 0,
    brands_updated: 0,
    brands_removed: 0,
    brands_unchanged: 0,
    errors: [],
  };

  const runResult = await pool.query<{ id: string }>(
    `INSERT INTO franchise_sync_runs (source, status)
     VALUES ('sba_directory', 'running')
     RETURNING id`
  );
  const runId = runResult.rows[0]!.id;
  const startTime = Date.now();

  try {
    const xlsxUrl = await discoverXlsxUrl();
    console.log(`[franchise-sync] downloading SBA directory xlsx from ${xlsxUrl}`);
    const response = await fetch(xlsxUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download SBA directory: ${response.status} ${response.statusText}`
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[franchise-sync] downloaded ${buffer.length} bytes`);

    const { rows, fileHash, columnHeaders } = parseSbaDirectoryXlsx(buffer);
    stats.total_rows_in_source = rows.length;
    console.log(
      `[franchise-sync] parsed ${rows.length} rows, columns: ${columnHeaders.join(', ')}`
    );

    await pool.query(
      `UPDATE franchise_sync_runs
       SET source_file_sha256 = $1, total_rows_in_source = $2
       WHERE id = $3`,
      [fileHash, rows.length, runId]
    );

    const { diffs } = await computeDiff(pool, rows);
    const addedCount = diffs.filter(d => d.type === 'added').length;
    const updatedCount = diffs.filter(d => d.type === 'updated').length;
    const removedCount = diffs.filter(d => d.type === 'removed').length;
    console.log(
      `[franchise-sync] diffs: ${addedCount} added, ${updatedCount} updated, ${removedCount} removed`
    );

    // Dedupe rows by sba_directory_id so a single batch never targets the
    // same conflict row twice (Postgres rejects that for ON CONFLICT DO UPDATE).
    const dedupedBrands = dedupeBySbaDirectoryId(rows);
    console.log(
      `[franchise-sync] batching ${dedupedBrands.length} brand upserts + ` +
        `${rows.length} snapshots in chunks of ${BATCH_SIZE}`
    );

    const upsertStart = Date.now();
    await batchUpsertBrands(pool, dedupedBrands, stats);
    console.log(`[franchise-sync] brand upserts done in ${Date.now() - upsertStart}ms`);

    const snapStart = Date.now();
    await batchInsertSnapshots(pool, runId, rows, stats);
    console.log(`[franchise-sync] snapshot inserts done in ${Date.now() - snapStart}ms`);

    stats.brands_added = addedCount;
    stats.brands_updated = updatedCount;
    stats.brands_removed = removedCount;
    stats.brands_unchanged = rows.length - stats.brands_added - stats.brands_updated;

    for (const diff of diffs.filter(d => d.type === 'removed')) {
      try {
        await pool.query(
          `UPDATE franchise_brands
           SET sba_eligible = false,
               sba_certification_status = 'removed',
               updated_at = now()
           WHERE lower(brand_name) = $1
             AND sba_eligible = true`,
          [diff.brand_name.toLowerCase()]
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ brand_name: diff.brand_name, error: `remove-mark: ${msg}` });
      }
    }

    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE franchise_sync_runs
       SET status = 'complete',
           brands_added = $1,
           brands_updated = $2,
           brands_removed = $3,
           brands_unchanged = $4,
           errors = $5,
           error_count = $6,
           completed_at = now(),
           duration_ms = $7
       WHERE id = $8`,
      [
        stats.brands_added,
        stats.brands_updated,
        stats.brands_removed,
        stats.brands_unchanged,
        JSON.stringify(stats.errors),
        stats.errors.length,
        duration,
        runId,
      ]
    );

    console.log(
      `[franchise-sync] complete in ${duration}ms — ` +
        `${stats.brands_added} added, ${stats.brands_updated} updated, ` +
        `${stats.brands_removed} removed, ${stats.brands_unchanged} unchanged, ` +
        `${stats.errors.length} errors`
    );

    return stats;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE franchise_sync_runs
       SET status = 'failed',
           errors = $1,
           error_count = 1,
           completed_at = now(),
           duration_ms = $2
       WHERE id = $3`,
      [JSON.stringify([{ brand_name: '_global', error: msg }]), duration, runId]
    );
    console.error(`[franchise-sync] FAILED: ${msg}`);
    throw err;
  }
}

/** Dedupe input rows by computed sba_directory_id, keeping the last occurrence.
 *  A single batched UPSERT can't target the same conflict row twice. */
function dedupeBySbaDirectoryId(rows: SbaDirectoryRow[]): SbaDirectoryRow[] {
  const byId = new Map<string, SbaDirectoryRow>();
  for (const row of rows) {
    const key = row.sba_franchise_id || row.brand_name;
    byId.set(key, row);
  }
  return Array.from(byId.values());
}

/** Y-flag columns in the SBA xlsx contain values like "Y", "y", "Yes", or blank.
 *  Anything else — including "N" — is treated as "no". */
function isYes(val: string | null): boolean {
  if (!val) return false;
  const v = val.trim().toUpperCase();
  return v === 'Y' || v === 'YES';
}

/** Derive the sba_addendum_type from the two type-specific columns.
 *  Only one should be "Y" per brand, but if both are set, Form 2462 wins. */
function deriveAddendumType(row: SbaDirectoryRow): string | null {
  if (isYes(row.sba_addendum_form_2462)) return 'Form 2462';
  if (isYes(row.sba_negotiated_addendum)) return 'Negotiated';
  return null;
}

/** Normalize an effective-date string. Accepts ISO (YYYY-MM-DD) or ISO timestamps;
 *  returns null for anything that isn't a plausible date. The parser already
 *  converts Date objects to ISO strings. */
function normalizeEffectiveDate(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1]! : null;
}

/** Multi-row UPSERT of franchise_brands, in chunks. One round-trip per chunk.
 *  On chunk failure, records a single batch-level error in stats and moves on. */
async function batchUpsertBrands(
  pool: Pool,
  rows: SbaDirectoryRow[],
  stats: SyncRunStats
): Promise<void> {
  const COLS = 11;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((row, idx) => {
      const base = idx * COLS;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
          `$${base + 11})`
      );
      values.push(
        row.brand_name,
        row.franchisor_name,
        row.sba_franchise_id || row.brand_name,
        true,                                   // sba_eligible
        isYes(row.certification) ? 'certified' : 'pending',
        isYes(row.addendum),                    // sba_addendum_required
        deriveAddendumType(row),                // sba_addendum_type
        parsePrograms(row.programs),
        row.notes,
        normalizeEffectiveDate(row.directory_effective_date),
        'sba_directory'
      );
    });

    const sql = `
      INSERT INTO franchise_brands
        (brand_name, franchisor_legal_name, sba_directory_id,
         sba_eligible, sba_certification_status, sba_addendum_required,
         sba_addendum_type, sba_programs, sba_notes,
         sba_directory_effective_date, source)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (sba_directory_id)
      DO UPDATE SET
        brand_name = EXCLUDED.brand_name,
        franchisor_legal_name = EXCLUDED.franchisor_legal_name,
        sba_eligible = EXCLUDED.sba_eligible,
        sba_certification_status = EXCLUDED.sba_certification_status,
        sba_addendum_required = EXCLUDED.sba_addendum_required,
        sba_addendum_type = EXCLUDED.sba_addendum_type,
        sba_programs = EXCLUDED.sba_programs,
        sba_notes = EXCLUDED.sba_notes,
        sba_directory_effective_date = EXCLUDED.sba_directory_effective_date,
        updated_at = now()`;

    try {
      await pool.query(sql, values);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push({
        brand_name: `_batch_${i}-${i + chunk.length - 1}`,
        error: `brand upsert batch failed: ${msg}`,
      });
      console.error(`[franchise-sync] brand batch ${i}-${i + chunk.length - 1} failed: ${msg}`);
    }
  }
}

/** Multi-row INSERT of franchise_sba_directory_snapshots, in chunks. */
async function batchInsertSnapshots(
  pool: Pool,
  runId: string,
  rows: SbaDirectoryRow[],
  stats: SyncRunStats
): Promise<void> {
  const COLS = 10;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    chunk.forEach((row, idx) => {
      const base = idx * COLS;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
          `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`
      );
      values.push(
        runId,
        hashRow(row),
        row.brand_name,
        row.franchisor_name,
        row.sba_franchise_id,
        row.certification,
        row.addendum,
        row.programs,
        row.notes,
        JSON.stringify(row.raw_json)
      );
    });

    const sql = `
      INSERT INTO franchise_sba_directory_snapshots
        (sync_run_id, row_hash, brand_name, franchisor_name,
         sba_franchise_id, certification, addendum, programs, notes, raw_json)
      VALUES ${placeholders.join(',')}`;

    try {
      await pool.query(sql, values);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push({
        brand_name: `_snapshot_batch_${i}-${i + chunk.length - 1}`,
        error: `snapshot insert batch failed: ${msg}`,
      });
      console.error(
        `[franchise-sync] snapshot batch ${i}-${i + chunk.length - 1} failed: ${msg}`
      );
    }
  }
}

function parsePrograms(raw: string | null): string[] {
  if (!raw) return ['7a'];
  const lower = raw.toLowerCase();
  const programs: string[] = [];
  if (lower.includes('7(a)') || lower.includes('7a')) programs.push('7a');
  if (lower.includes('504')) programs.push('504');
  if (lower.includes('community')) programs.push('community_advantage');
  if (lower.includes('micro')) programs.push('microlending');
  if (programs.length === 0) programs.push('7a');
  return programs;
}
