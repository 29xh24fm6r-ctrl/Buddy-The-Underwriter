/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3)
 *
 * Certify personal-income values for the classic spread by selecting the strongest source
 * across OWNER families for the same tax year + semantic key, and blocking weak OCR micro-
 * stubs (W-2 = 3, AGI = 0, TAXABLE = 456) when a stronger PERSONAL_TAX_RETURN / DEAL-owned
 * fact exists.
 *
 * Why this is its OWN selector (not Phase 1 certifyFactSelection): the weak family is
 * owner_type=PERSONAL / fact_type=PERSONAL_INCOME and the strong family is owner_type=DEAL /
 * PERSONAL_TAX_RETURN. reconcileFinancialFacts groups by (key, period, OWNER), so it never
 * compares the two families — and per SPEC it must NOT be modified. This module therefore
 * does a self-contained CROSS-OWNER selection and intentionally imports nothing from
 * reconcileFinancialFacts.
 *
 * Pure (no DB, no IO). No PDF/schema/route change.
 */

import {
  certifiedDirectFact,
  certifiedUnavailable,
  type CertifiedSpreadValue,
} from "./certifiedSpreadValue";
import { auditRowFromValue, type CertifiedAuditRow } from "./certifiedSpreadAudit";

// Materiality thresholds (same scale as the rest of the certification layer).
const MATERIAL_MIN = 1000;
const MICRO_ABS = 100;
const TINY_RATIO = 0.05; // < 5% of the material sibling is a "tiny" stub

/** Personal-income fact candidate — a deliberately local shape (no reconcile coupling). */
export type PersonalIncomeFact = {
  id: string | null;
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  source_document_id: string | null;
  source_canonical_type: string | null;
  fact_type?: string | null;
  confidence: number | null;
  extractor: string | null;
  is_superseded?: boolean | null;
  resolution_status?: string | null;
};

/** Semantic personal-income rows the classic spread renders, with their fact-key aliases. */
export type PersonalIncomeKeySpec = { semantic: string; aliases: string[] };

export const PERSONAL_INCOME_KEYS: PersonalIncomeKeySpec[] = [
  { semantic: "WAGES_W2", aliases: ["WAGES_W2"] },
  { semantic: "ADJUSTED_GROSS_INCOME", aliases: ["ADJUSTED_GROSS_INCOME", "AGI"] },
  { semantic: "TAXABLE_INCOME", aliases: ["TAXABLE_INCOME"] },
  { semantic: "TOTAL_TAX", aliases: ["TOTAL_TAX"] },
];

const NON_SELECTABLE_STATUSES = new Set(["rejected", "system_invalidated"]);

export type RejectedCompetitor = {
  factId: string | null;
  value: number | null;
  ownerType: string;
  sourceFamily: string | null;
  confidence: number | null;
  reason: string;
};

export type PersonalIncomeCertification = {
  semantic: string;
  year: number;
  value: CertifiedSpreadValue;
  /** winner provenance (null when unavailable) */
  ownerType: string | null;
  sourceFamily: string | null;
  /** every competing candidate that lost selection, with why */
  rejected: RejectedCompetitor[];
  reason: string;
};

export type CertifiedPersonalIncome = {
  certifications: PersonalIncomeCertification[];
  auditRows: CertifiedAuditRow[];
};

function yearOf(periodEnd: string | null): number | null {
  if (!periodEnd) return null;
  const m = /^(\d{4})/.exec(periodEnd);
  return m ? parseInt(m[1], 10) : null;
}

/** Coarse personal-source family label for the audit trace. */
function sourceFamily(f: PersonalIncomeFact): string {
  const sct = (f.source_canonical_type ?? "").toUpperCase();
  const ft = (f.fact_type ?? "").toUpperCase();
  if (sct.includes("PERSONAL_TAX_RETURN") || ft.includes("TAX_RETURN")) return "PERSONAL_TAX_RETURN";
  if (ft.includes("PERSONAL_INCOME")) return "PERSONAL_INCOME";
  return sct || ft || "UNKNOWN";
}

/**
 * Source-quality rank (higher wins). Prefers mapped 1040 tax-return facts, Gemini-backed
 * extraction and DEAL-owned canonical personal-tax facts over the deterministic OCR
 * personal-income micro extractor.
 */
function personalSourceRank(f: PersonalIncomeFact): number {
  const ex = (f.extractor ?? "").toLowerCase();
  const sct = (f.source_canonical_type ?? "").toLowerCase();
  const ft = (f.fact_type ?? "").toLowerCase();
  const owner = (f.owner_type ?? "").toUpperCase();
  let rank = 0;
  if (sct.includes("tax_return") || ft.includes("tax_return")) rank += 40; // mapped 1040 family
  if (ex.includes("gemini")) rank += 20;
  if (owner === "DEAL") rank += 10; // DEAL-owned canonical personal-tax facts
  if (ex.includes("personalincomeextractor")) rank -= 15; // deterministic OCR micro extractor
  return rank;
}

/**
 * Certify each (year, semantic) personal-income value by cross-owner selection.
 * `opts.keys` overrides the default key set; `opts.ownerEntityId` restricts candidates to a
 * single borrower when provided.
 */
export function certifyPersonalIncome(
  facts: PersonalIncomeFact[],
  opts?: { keys?: PersonalIncomeKeySpec[]; ownerEntityId?: string | null },
): CertifiedPersonalIncome {
  const keys = opts?.keys ?? PERSONAL_INCOME_KEYS;
  const pinOwner = opts?.ownerEntityId ?? null;

  // Lifecycle filter: superseded / rejected / system_invalidated / null are never selectable.
  const selectable = facts.filter((f) => {
    if (pinOwner && f.owner_entity_id !== pinOwner) return false;
    if (f.is_superseded === true) return false;
    if (NON_SELECTABLE_STATUSES.has((f.resolution_status ?? "").toLowerCase())) return false;
    return f.fact_value_num !== null;
  });

  const certifications: PersonalIncomeCertification[] = [];
  const auditRows: CertifiedAuditRow[] = [];

  // Distinct years present (deterministic ascending order).
  const years = [...new Set(selectable.map((f) => yearOf(f.fact_period_end)).filter((y): y is number => y !== null))].sort();

  for (const year of years) {
    for (const spec of keys) {
      const candidates = selectable.filter(
        (f) => yearOf(f.fact_period_end) === year && spec.aliases.includes(f.fact_key),
      );
      if (candidates.length === 0) continue;

      const maxMaterialAbs = Math.max(
        0,
        ...candidates.map((c) => Math.abs(c.fact_value_num as number)).filter((v) => v >= MATERIAL_MIN),
      );
      const isStub = (v: number): boolean =>
        maxMaterialAbs >= MATERIAL_MIN && (Math.abs(v) < MICRO_ABS || Math.abs(v) < maxMaterialAbs * TINY_RATIO);

      const rejected: RejectedCompetitor[] = [];
      const viable: PersonalIncomeFact[] = [];
      for (const c of candidates) {
        const v = c.fact_value_num as number;
        if (isStub(v)) {
          rejected.push({
            factId: c.id,
            value: v,
            ownerType: c.owner_type,
            sourceFamily: sourceFamily(c),
            confidence: c.confidence,
            reason: `${spec.semantic} = ${v} is an OCR micro-stub contradicted by a stronger ${maxMaterialAbs} (same year, cross-owner); blocked from selection.`,
          });
        } else {
          viable.push(c);
        }
      }

      const period = `${year}-12-31`;

      if (viable.length === 0) {
        // Only contradicted stubs existed for this key/year — render blank, not garbage.
        const value = certifiedUnavailable(
          `${spec.semantic} ${year}: all candidates were contradicted micro-stubs; no certifiable value.`,
        );
        certifications.push({ semantic: spec.semantic, year, value, ownerType: null, sourceFamily: null, rejected, reason: value.failureReason! });
        auditRows.push(auditRowFromValue("personal_income", spec.semantic, period, value));
        continue;
      }

      // Winner: strongest source rank, then confidence, then larger magnitude, then stable id.
      const ordered = [...viable].sort((a, b) => {
        const r = personalSourceRank(b) - personalSourceRank(a);
        if (r !== 0) return r;
        const c = (b.confidence ?? 0) - (a.confidence ?? 0);
        if (c !== 0) return c;
        const m = Math.abs(b.fact_value_num as number) - Math.abs(a.fact_value_num as number);
        if (m !== 0) return m;
        return (a.id ?? "").localeCompare(b.id ?? "");
      });
      const winner = ordered[0];

      // Non-winning viable candidates are also recorded (lost on source quality / confidence).
      for (const c of ordered.slice(1)) {
        rejected.push({
          factId: c.id,
          value: c.fact_value_num,
          ownerType: c.owner_type,
          sourceFamily: sourceFamily(c),
          confidence: c.confidence,
          reason: `${spec.semantic} = ${c.fact_value_num} lost to a stronger-source / higher-confidence sibling.`,
        });
      }

      const winnerFamily = sourceFamily(winner);
      const blockedNote =
        rejected.length > 0
          ? [`Selected over ${rejected.length} weaker competitor(s); blocked micro-stubs: ${rejected.filter((r) => /micro-stub/.test(r.reason)).map((r) => r.value).join(", ") || "none"}.`]
          : [];
      const value = certifiedDirectFact(
        winner.fact_value_num,
        {
          factId: winner.id,
          factKey: winner.fact_key,
          documentId: winner.source_document_id,
          canonicalType: winner.source_canonical_type,
          confidence: winner.confidence,
        },
        blockedNote,
      );

      certifications.push({
        semantic: spec.semantic,
        year,
        value,
        ownerType: winner.owner_type,
        sourceFamily: winnerFamily,
        rejected,
        reason: `Certified ${winner.fact_value_num} from ${winnerFamily} (owner ${winner.owner_type}, confidence ${winner.confidence ?? "n/a"}).`,
      });
      auditRows.push(auditRowFromValue("personal_income", spec.semantic, period, value));
    }
  }

  return { certifications, auditRows };
}

/** Look up the certified value for a (semantic, year), or null when not present. */
export function getPersonalCertified(
  result: CertifiedPersonalIncome,
  semantic: string,
  year: number,
): CertifiedSpreadValue | null {
  return result.certifications.find((c) => c.semantic === semantic && c.year === year)?.value ?? null;
}
