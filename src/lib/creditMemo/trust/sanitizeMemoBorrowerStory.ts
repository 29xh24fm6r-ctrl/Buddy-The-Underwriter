/**
 * Pure helper — sanitizes borrower story narrative fields at memo render time.
 *
 * Accepts ownerEntities + managementProfiles (already loaded by
 * buildCanonicalCreditMemo), builds the people registry, and returns a
 * sanitized copy of every narrative field. Financial facts, structured party
 * fields, and guarantor display names are NOT touched.
 *
 * No DB, no server-only.
 */

import {
  buildMemoPeopleFromRows,
  sanitizeMemoNarrativeText,
  type MemoPersonReference,
  type NarrativeTrustWarning,
} from "./memoNarrativeTrust";

export type BorrowerStoryNarrativeFields = {
  business_description?: string | null;
  revenue_mix?: string | null;
  seasonality?: string | null;
  competitive_advantages?: string | null;
  vision?: string | null;
  products_services?: string | null;
  customers?: string | null;
  customer_concentration?: string | null;
  key_risks?: string | null;
};

export type SanitizeMemoBorrowerStoryResult = {
  fields: BorrowerStoryNarrativeFields;
  warnings: NarrativeTrustWarning[];
};

export function sanitizeMemoBorrowerStory(args: {
  fields: BorrowerStoryNarrativeFields;
  ownerEntities: Array<{ display_name?: string | null; name?: string | null; ownership_pct?: number | null }>;
  managementProfiles: Array<{ person_name?: string | null; ownership_pct?: number | null }>;
}): SanitizeMemoBorrowerStoryResult {
  const people: MemoPersonReference[] = buildMemoPeopleFromRows({
    ownerEntities: args.ownerEntities,
    managementProfiles: args.managementProfiles,
  });

  const out: Record<string, string | null | undefined> = {};
  const warnings: NarrativeTrustWarning[] = [];

  for (const [key, value] of Object.entries(args.fields)) {
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }
    const result = sanitizeMemoNarrativeText(value, people);
    out[key] = result.text;
    warnings.push(...result.warnings.map((w) => ({ ...w, detail: `business_summary.${key}: ${w.detail}` })));
  }

  return { fields: out as BorrowerStoryNarrativeFields, warnings };
}
