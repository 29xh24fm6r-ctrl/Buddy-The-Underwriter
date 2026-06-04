/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 5
 *
 * Public adverse-screen adapter. MVP: NO sanctions-DB integration. Builds a
 * structured screen plan (targets × categories) with deterministic candidate
 * URLs where safe, supports a manual attestation, and — critically — NEVER
 * produces an adverse claim without a source URL or an explicit attestation
 * (opensanctions/watchman lesson: candidate hits are not final, all hits require
 * review). Pure module.
 */

import type {
  AdverseScreenCategory,
  AdverseScreenChecklistItem,
  AdverseScreenDisposition,
  AdverseScreenPlan,
  AdverseScreenResultType,
  AdverseScreenTarget,
} from "./types";

const RESULT_TYPES: AdverseScreenResultType[] = [
  "no_public_adverse_records_found_attestation",
  "potential_hit_needs_review",
  "confirmed_adverse_record",
  "unable_to_complete",
];

/** Deterministic, free public-search portals per category (or null → manual). */
const CATEGORY_SOURCES: Record<AdverseScreenCategory, { label: string; url: string | null }> = {
  court: { label: "Federal court records (CourtListener / RECAP)", url: "https://www.courtlistener.com/" },
  regulatory: { label: "Federal regulatory / debarment (SAM.gov exclusions)", url: "https://sam.gov/search/" },
  lien_judgment: { label: "UCC / lien / judgment search (state SOS UCC portal)", url: null },
  sanctions_watchlist: { label: "OFAC sanctions list search", url: "https://sanctionssearch.ofac.treas.gov/" },
};

export function buildAdverseScreenPlan(opts: {
  legalName?: string | null;
  dba?: string | null;
  principals?: Array<{ person_name?: string | null } | string>;
  includeSanctions?: boolean; // default false — sanctions DB integration not built yet
}): AdverseScreenPlan {
  const targets: AdverseScreenTarget[] = [];
  if (opts.legalName?.trim()) targets.push({ kind: "borrower_legal_name", value: opts.legalName.trim() });
  if (opts.dba?.trim()) targets.push({ kind: "dba", value: opts.dba.trim() });
  for (const p of opts.principals ?? []) {
    const name = (typeof p === "string" ? p : p?.person_name ?? "").trim();
    if (name) targets.push({ kind: "principal", value: name });
  }

  const categories: AdverseScreenCategory[] = ["court", "regulatory", "lien_judgment"];
  if (opts.includeSanctions) categories.push("sanctions_watchlist");

  const checklist: AdverseScreenChecklistItem[] = categories.map((category) => {
    const src = CATEGORY_SOURCES[category];
    const supported = !!src.url;
    return {
      category,
      label: src.label,
      candidate_url: src.url,
      supported,
      limitations: [
        supported
          ? "Free public search — a negative result is not conclusive; record search scope/date."
          : "No deterministic free portal — perform the lookup manually or attach an analyst attestation.",
        ...(category === "sanctions_watchlist" ? ["Sanctions/watchlist screening is not integrated; treat as advisory."] : []),
      ],
    };
  });

  return {
    targets,
    checklist,
    result_types: RESULT_TYPES,
    limitations: [
      "All hits are candidates requiring analyst review — never auto-cleared and never auto-confirmed.",
      "A 'no records found' disposition is an attestation, not proof of absence.",
    ],
  };
}

/**
 * Validate an adverse-screen disposition. ENFORCES: a 'potential_hit' or
 * 'confirmed_adverse_record' disposition MUST carry a source_url; a
 * 'no records found' / 'unable_to_complete' disposition MUST carry an attestor.
 * Never allows an unsupported adverse claim.
 */
export function validateAdverseDisposition(
  d: AdverseScreenDisposition,
): { ok: boolean; error?: string } {
  if (!RESULT_TYPES.includes(d.result_type)) return { ok: false, error: "invalid_result_type" };
  const hasSource = !!(d.source_url ?? "").trim();
  const hasAttestor = !!(d.attested_by ?? "").trim();

  if (d.result_type === "potential_hit_needs_review" || d.result_type === "confirmed_adverse_record") {
    if (!hasSource) return { ok: false, error: "adverse_claim_requires_source_url" };
  }
  if (
    d.result_type === "no_public_adverse_records_found_attestation" ||
    d.result_type === "unable_to_complete"
  ) {
    if (!hasAttestor) return { ok: false, error: "attestation_requires_attestor" };
  }
  return { ok: true };
}
