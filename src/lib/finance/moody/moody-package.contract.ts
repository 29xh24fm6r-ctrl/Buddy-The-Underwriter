// src/lib/finance/moody/moody-package.contract.ts

/**
 * Moody Package Contract (Single Source of Truth)
 * ------------------------------------------------
 * This file is the canonical place for *all* Moody package types.
 * Everything else must import from here (or from the barrel in Step 2).
 */

export type MoodyPnlLine = {
  label: string;
  amount: number;
};

export type MoodyPnlPeriod = {
  /** e.g. "FY2023", "TTM", "2024-09", etc. */
  period_label: string;
  /** Optional period end date (ISO) if you have it */
  period_end_date?: string;

  lines: MoodyPnlLine[];

  /** Convenience rollups (optional, but stable keys if present) */
  revenue?: number;
  gross_profit?: number;
  ebitda?: number;
  net_income?: number;
};

export type MoodyPnlMeta = {
  /** Provenance for auditability */
  source: "C4" | "MANUAL" | "UNKNOWN";
  source_file_id?: string;
  source_stored_name?: string;

  /** When the package was built */
  built_at_iso: string;

  /** Allows future evolution without breaking old readers */
  schema_version: 1;
};

export type MoodyPnlPackage = {
  meta: MoodyPnlMeta;

  /** One or more periods in display order (most recent last or first—your choice, but keep it consistent) */
  periods: MoodyPnlPeriod[];

  /**
   * Optional: normalized notes/warnings you want to show in UI.
   * Keep stable shape so the UI can rely on it.
   */
  warnings?: { code: string; message: string }[];
};
