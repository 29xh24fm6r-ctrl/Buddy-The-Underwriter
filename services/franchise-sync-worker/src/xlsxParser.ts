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
  // Brand name — SBA uses just "BRAND" on the current xlsx
  'brand name': 'brand_name',
  'brand': 'brand_name',
  'franchise name': 'brand_name',

  // Franchisor name (not present on current xlsx — kept for future schema changes)
  'franchisor name': 'franchisor_name',
  'franchisor': 'franchisor_name',

  // Identifier — SBA uses "SBA FRANCHISE IDENTIFIER CODE"
  'sba franchise identifier code': 'sba_franchise_id',
  'sba franchise identifier': 'sba_franchise_id',
  'franchise identifier': 'sba_franchise_id',
  'identifier': 'sba_franchise_id',

  // Certification — SBA uses "Franchisor/ Distributor Certification Received?"
  'franchisor/ distributor certification received?': 'certification',
  'franchisor / distributor certification received?': 'certification',
  'franchisor certification': 'certification',
  'certification': 'certification',
  'certified': 'certification',

  // Addendum-required flag — SBA uses "IS AN ADDENDUM NEEDED?"
  'is an addendum needed?': 'addendum',
  'addendum needed': 'addendum',
  'addendum': 'addendum',

  // Addendum variants (new as of current xlsx)
  'sba addendum - form 2462': 'sba_addendum_form_2462',
  'sba addendum form 2462': 'sba_addendum_form_2462',
  'form 2462': 'sba_addendum_form_2462',
  'sba negotiated addendum': 'sba_negotiated_addendum',
  'negotiated addendum': 'sba_negotiated_addendum',

  // Effective date — SBA uses "SBA FRANCHISE IDENTIFIER CODE Start Date"
  'sba franchise identifier code start date': 'directory_effective_date',
  'start date': 'directory_effective_date',
  'effective date': 'directory_effective_date',

  // Programs — not present on current xlsx. Listed brands default to 7(a)
  // eligible (that's the point of the directory). Kept for forward compat.
  'loan programs': 'programs',
  'programs': 'programs',
  'program eligibility': 'programs',

  // Notes
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
  // cellDates:true converts date-formatted cells to JS Date objects, so the
  // mapping step below can normalize them to ISO strings deterministically.
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });

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
    // SBA headers sometimes contain runs of whitespace (e.g. "IS AN  ADDENDUM NEEDED?"
    // with two spaces). Collapse to a single space so the map matches.
    const normalized = header.toLowerCase().trim().replace(/\s+/g, ' ');
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
      let normalized: string | null;
      if (val == null) {
        normalized = null;
      } else if (val instanceof Date) {
        // ISO date (YYYY-MM-DD) — Postgres accepts this directly for `date` columns
        normalized = isNaN(val.getTime()) ? null : val.toISOString().slice(0, 10);
      } else {
        const s = String(val).trim();
        normalized = s === '' ? null : s;
      }
      (mapped as Record<string, unknown>)[canonicalField] = normalized;
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
    sba_addendum_form_2462: row.sba_addendum_form_2462,
    sba_negotiated_addendum: row.sba_negotiated_addendum,
    directory_effective_date: row.directory_effective_date,
    programs: row.programs,
    notes: row.notes,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
