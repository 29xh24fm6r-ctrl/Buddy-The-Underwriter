import type {
  BorrowerRequirementsResult,
  BorrowerRequirementsSummary,
  BorrowerRequirement,
  RequirementStatus,
} from "./types";
import { buildSba7aRequirements } from "@/lib/sba7a/requirements";

type AttachmentRow = {
  file_key: string;
  stored_name?: string | null;
  mime_type?: string | null;
  size?: number | null;
  meta?: any; // jsonb
};

function getDocType(a: AttachmentRow): string | null {
  const m = a.meta ?? {};
  // allow multiple possible metadata shapes
  return (
    m?.doc_type ??
    m?.classification?.doc_type ??
    m?.classification?.type ??
    null
  );
}

function getTaxYear(a: AttachmentRow): number | null {
  const m = a.meta ?? {};
  const y = m?.tax_year ?? m?.classification?.tax_year ?? null;
  const n = typeof y === "number" ? y : Number(String(y ?? ""));
  return Number.isFinite(n) ? n : null;
}

function getConfidence(a: AttachmentRow): number | null {
  const m = a.meta ?? {};
  const c = m?.confidence ?? m?.classification?.confidence ?? null;
  const n = typeof c === "number" ? c : Number(String(c ?? ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive tax years:
 * - primary: from attachments meta.tax_year
 * - fallback: if none, default last 2 calendar years (currentYear-1, currentYear-2)
 */
function deriveTaxYears(attachments: AttachmentRow[], yearsCount: number) {
  const years = new Set<number>();
  for (const a of attachments) {
    const y = getTaxYear(a);
    if (y && y > 1900 && y < 3000) years.add(y);
  }

  const arr = Array.from(years).sort((a, b) => b - a);

  if (arr.length > 0) return arr.slice(0, Math.max(1, yearsCount));

  const now = new Date();
  const cy = now.getFullYear();
  return [cy - 1, cy - 2].slice(0, yearsCount);
}

function computeSummary(reqs: BorrowerRequirement[]): BorrowerRequirementsSummary {
  const required = reqs.filter(r => r.required);
  const optional = reqs.filter(r => !r.required);

  const required_total = required.length;
  const required_satisfied = required.filter(r => r.status === "SATISFIED").length;
  const required_missing = required.filter(r => r.status === "MISSING").length;
  const required_partial = required.filter(r => r.status === "PARTIAL").length;

  const optional_total = optional.length;
  const optional_satisfied = optional.filter(r => r.status === "SATISFIED").length;

  return {
    required_total,
    required_satisfied,
    required_missing,
    required_partial,
    optional_total,
    optional_satisfied,
  };
}

function statusForEvidence(required: boolean, hits: any[], expectsMany = false): RequirementStatus {
  if (hits.length === 0) return required ? "MISSING" : "OPTIONAL";
  if (expectsMany && hits.length === 1) return required ? "PARTIAL" : "SATISFIED";
  return "SATISFIED";
}

export function evaluateBorrowerRequirements(input: {
  track: "SBA_7A" | "CONVENTIONAL";
  attachments: AttachmentRow[];
  years_required?: number; // default 2
}): BorrowerRequirementsResult {
  const yearsRequired = input.years_required ?? 2;
  const taxYears = deriveTaxYears(input.attachments, yearsRequired);

  // For this sprint we implement SBA_7A requirements only (conventional can be added next).
  const baseReqs =
    input.track === "SBA_7A"
      ? buildSba7aRequirements({ tax_years: taxYears, require_years_count: yearsRequired })
      : []; // TODO next sprint

  const evaluated: BorrowerRequirement[] = baseReqs.map((r) => {
    const hits = (input.attachments ?? [])
      .map((a) => {
        const docType = getDocType(a);
        const year = getTaxYear(a);
        const conf = getConfidence(a);

        // doc_type match
        const typeOk = !r.doc_types || r.doc_types.length === 0
          ? false
          : (docType ? r.doc_types.includes(docType) : false);

        // year match if requirement is year-specific
        const yearOk = typeof r.year === "number" ? (year === r.year) : true;

        if (!typeOk || !yearOk) return null;

        return {
          file_key: a.file_key,
          stored_name: a.stored_name ?? undefined,
          doc_type: docType ?? undefined,
          tax_year: year,
          confidence: conf,
        };
      })
      .filter(Boolean) as any[];

    const expectsMany = false;
    const status = statusForEvidence(r.required, hits, expectsMany);

    return {
      ...r,
      status,
      evidence: hits,
    };
  });

  // If we defaulted tax years due to no data, add a helpful note to year-based requirements
  const hadRealYears = (input.attachments ?? []).some(a => getTaxYear(a) !== null);
  if (!hadRealYears) {
    for (const r of evaluated) {
      if (typeof r.year === "number") {
        r.notes = [
          ...(r.notes ?? []),
          "We're assuming standard recent tax years because no tax year was detected yet. Upload a return and this will auto-correct.",
        ];
      }
    }
  }

  const summary = computeSummary(evaluated);

  return {
    track: input.track,
    requirements: evaluated,
    summary,
    derived_tax_years: taxYears,
  };
}
