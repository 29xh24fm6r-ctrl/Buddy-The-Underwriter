import * as XLSX from 'xlsx';
import { createHash } from 'node:crypto';
import type { SbaDirectoryRow } from './types.js';

/**
 * Download and parse the SBA Franchise Directory xlsx.
 *
 * The xlsx is available at:
 *   https://www.sba.gov/document/support-sba-franchise-directory
 *
 * IMPORTANT: The column names in the xlsx may change between releases.
 * This parser normalizes column names to lowercase and maps them to our
 * canonical field names. If the SBA changes column names, update the
 * COLUMN_MAP below.
 */

const COLUMN_MAP: Record<string, keyof Omit<SbaDirectoryRow, 'raw_json'>> = {
  'brand name': 'brand_name',
  'brand': 'brand_name',
  'franchise name': 'brand_name',
  'franchisor name': 'franchisor_name',
  'franchisor': 'franchisor_name',
  'sba franchise identifier': 'sba_franchise_id',
  'franchise identifier': 'sba_franchise_id',
  'identifier': 'sba_franchise_id',
  'franchisor certification': 'certification',
  'certification': 'certification',
  'certified': 'certification',
  'addendum': 'addendum',
  'loan programs': 'programs',
  'programs': 'programs',
  'program eligibility': 'programs',
  'notes': 'notes',
  'note': 'notes',
};

export interface ParseResult {
  rows: SbaDirectoryRow[];
  fileHash: string;
  columnHeaders: string[];
}

export function parseSbaDirectoryXlsx(buffer: Buffer): ParseResult {
  const fileHash = createHash('sha256').update(buffer).digest('hex');
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('SBA directory xlsx has no sheets');
  }

  const sheet = workbook.Sheets[sheetName]!;
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  if (rawRows.length === 0) {
    throw new Error('SBA directory xlsx has no data rows');
  }

  const originalHeaders = Object.keys(rawRows[0]!);
  const headerMapping: Record<string, keyof Omit<SbaDirectoryRow, 'raw_json'>> = {};

  for (const header of originalHeaders) {
    const normalized = header.toLowerCase().trim();
    if (COLUMN_MAP[normalized]) {
      headerMapping[header] = COLUMN_MAP[normalized]!;
    }
  }

  const mappedFields = new Set(Object.values(headerMapping));
  if (!mappedFields.has('brand_name')) {
    throw new Error(
      `Could not find brand name column. Headers found: ${originalHeaders.join(', ')}. ` +
        `Update COLUMN_MAP in xlsxParser.ts if the SBA changed column names.`
    );
  }

  const rows: SbaDirectoryRow[] = [];

  for (const rawRow of rawRows) {
    const mapped: Partial<SbaDirectoryRow> = { raw_json: {} };

    for (const [originalHeader, canonicalField] of Object.entries(headerMapping)) {
      const val = rawRow[originalHeader];
      (mapped as Record<string, unknown>)[canonicalField] =
        val != null ? String(val).trim() : null;
    }

    mapped.raw_json = rawRow as Record<string, unknown>;

    if (!mapped.brand_name || mapped.brand_name.trim() === '') {
      continue;
    }

    rows.push(mapped as SbaDirectoryRow);
  }

  return { rows, fileHash, columnHeaders: originalHeaders };
}

/** Compute a deterministic hash for a single row (for dedup/diff) */
export function hashRow(row: SbaDirectoryRow): string {
  const canonical = JSON.stringify({
    brand_name: row.brand_name,
    franchisor_name: row.franchisor_name,
    sba_franchise_id: row.sba_franchise_id,
    certification: row.certification,
    addendum: row.addendum,
    programs: row.programs,
    notes: row.notes,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
