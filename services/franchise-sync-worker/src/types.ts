/** Raw row from the SBA Franchise Directory xlsx */
export interface SbaDirectoryRow {
  brand_name: string;
  franchisor_name: string | null;
  sba_franchise_id: string | null;
  certification: string | null;
  addendum: string | null;
  programs: string | null;
  notes: string | null;
  raw_json: Record<string, unknown>;
}

/** Diff result for a single brand */
export interface BrandDiff {
  type: 'added' | 'updated' | 'removed';
  brand_name: string;
  sba_franchise_id: string | null;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

/** Sync run stats */
export interface SyncRunStats {
  total_rows_in_source: number;
  brands_added: number;
  brands_updated: number;
  brands_removed: number;
  brands_unchanged: number;
  errors: Array<{ brand_name: string; error: string }>;
}
