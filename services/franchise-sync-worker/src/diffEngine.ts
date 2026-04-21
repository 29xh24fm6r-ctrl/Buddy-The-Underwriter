import type { Pool } from 'pg';
import type { SbaDirectoryRow, BrandDiff } from './types.js';
import { hashRow } from './xlsxParser.js';

/**
 * Compare current xlsx rows against the previous sync run's snapshot.
 *
 * Strategy:
 * 1. Load all snapshot rows from the most recent completed sync run
 * 2. Hash each new row
 * 3. Exact hash match = unchanged
 * 4. Same brand name, different hash = updated
 * 5. New brand name = added
 * 6. Previous brand name not in new set = removed
 */
export async function computeDiff(
  pool: Pool,
  newRows: SbaDirectoryRow[]
): Promise<{
  diffs: BrandDiff[];
  newRowHashes: Map<string, SbaDirectoryRow>;
  previousRowHashes: Set<string>;
}> {
  const prevResult = await pool.query<{ row_hash: string; brand_name: string }>(`
    SELECT s.row_hash, s.brand_name
    FROM franchise_sba_directory_snapshots s
    WHERE s.sync_run_id = (
      SELECT id FROM franchise_sync_runs
      WHERE source = 'sba_directory' AND status = 'complete'
      ORDER BY started_at DESC
      LIMIT 1
    )
  `);

  const previousHashes = new Set<string>(prevResult.rows.map(r => r.row_hash));
  const previousByName = new Map<string, string>(
    prevResult.rows.map(r => [r.brand_name.toLowerCase(), r.row_hash])
  );

  const newRowHashes = new Map<string, SbaDirectoryRow>();
  const newByName = new Map<string, string>();

  for (const row of newRows) {
    const hash = hashRow(row);
    newRowHashes.set(hash, row);
    newByName.set(row.brand_name.toLowerCase(), hash);
  }

  const diffs: BrandDiff[] = [];

  for (const [hash, row] of newRowHashes) {
    if (previousHashes.has(hash)) {
      continue;
    }

    const prevHash = previousByName.get(row.brand_name.toLowerCase());
    if (prevHash && prevHash !== hash) {
      diffs.push({
        type: 'updated',
        brand_name: row.brand_name,
        sba_franchise_id: row.sba_franchise_id,
      });
    } else if (!prevHash) {
      diffs.push({
        type: 'added',
        brand_name: row.brand_name,
        sba_franchise_id: row.sba_franchise_id,
      });
    }
  }

  for (const [prevName] of previousByName) {
    if (!newByName.has(prevName)) {
      diffs.push({
        type: 'removed',
        brand_name: prevName,
        sba_franchise_id: null,
      });
    }
  }

  return { diffs, newRowHashes, previousRowHashes: previousHashes };
}
