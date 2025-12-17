// src/lib/finance/normalize/normalizePnlFromC4.ts

import type { MoodyPnlPackage, MoodyPnlPeriod, MoodyPnlLine } from "@/lib/finance/moody";

type C4LikeInput = any;

/**
 * Build a MoodyPnlPackage from a C4 (Document Intelligence) normalized structure.
 * IMPORTANT: This function's return type is the contract. Do not change lightly.
 */
export const buildMoodyPackageFromC4 = buildMoodyPnlPackageFromC4;

export default function buildMoodyPnlPackageFromC4(input: C4LikeInput): MoodyPnlPackage {
  const builtAt = new Date().toISOString();

  // TODO: Replace these placeholder transforms with your real mapping logic.
  const periods: MoodyPnlPeriod[] = normalizePeriods(input);

  return {
    meta: {
      source: "C4",
      built_at_iso: builtAt,
      schema_version: 1,
      // If you have these available, thread them in:
      // source_file_id: input?.file_id,
      // source_stored_name: input?.stored_name,
    },
    periods,
    warnings: [],
  };
}

function normalizePeriods(input: C4LikeInput): MoodyPnlPeriod[] {
  // Minimal safe default so contract is always satisfied:
  const lines: MoodyPnlLine[] = [];

  // Example: if you have extracted fields, map them into stable lines
  // lines.push({ label: "Revenue", amount: Number(input?.revenue ?? 0) });

  return [
    {
      period_label: "UNKNOWN",
      lines,
    },
  ];
}
