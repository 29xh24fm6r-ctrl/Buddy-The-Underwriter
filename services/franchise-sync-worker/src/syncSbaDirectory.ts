import type { Pool } from 'pg';
import { parseSbaDirectoryXlsx, hashRow } from './xlsxParser.js';
import { computeDiff } from './diffEngine.js';
import type { SyncRunStats, SbaDirectoryRow } from './types.js';

const SBA_DIRECTORY_URL =
  process.env.SBA_DIRECTORY_URL ||
  'https://www.sba.gov/sites/default/files/franchise_directory.xlsx';

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
    console.log(`[franchise-sync] downloading SBA directory xlsx from ${SBA_DIRECTORY_URL}`);
    const response = await fetch(SBA_DIRECTORY_URL);
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

    for (const row of rows) {
      try {
        await upsertBrand(pool, row);

        const rh = hashRow(row);
        await pool.query(
          `INSERT INTO franchise_sba_directory_snapshots
             (sync_run_id, row_hash, brand_name, franchisor_name,
              sba_franchise_id, certification, addendum, programs, notes, raw_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            runId,
            rh,
            row.brand_name,
            row.franchisor_name,
            row.sba_franchise_id,
            row.certification,
            row.addendum,
            row.programs,
            row.notes,
            JSON.stringify(row.raw_json),
          ]
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.errors.push({ brand_name: row.brand_name, error: msg });
        console.error(`[franchise-sync] error upserting ${row.brand_name}: ${msg}`);
      }
    }

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

async function upsertBrand(pool: Pool, row: SbaDirectoryRow): Promise<void> {
  const isCertified = row.certification?.toUpperCase() === 'Y';
  const programs = parsePrograms(row.programs);

  await pool.query(
    `INSERT INTO franchise_brands
       (brand_name, franchisor_legal_name, sba_directory_id,
        sba_eligible, sba_certification_status, sba_addendum_required,
        sba_addendum_type, sba_programs, sba_notes, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sba_directory')
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
       updated_at = now()`,
    [
      row.brand_name,
      row.franchisor_name,
      row.sba_franchise_id || row.brand_name,
      true,
      isCertified ? 'certified' : 'pending',
      !!row.addendum,
      row.addendum,
      programs,
      row.notes,
    ]
  );
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
