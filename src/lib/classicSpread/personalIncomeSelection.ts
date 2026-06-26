/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 3) — loader integration.
 *
 * PURE core (no DB, no IO) that turns a deal's raw personal-income candidate facts into the
 * rendered PersonalIncomeYear[] rows by routing selection through the certified cross-owner
 * selector (certifyPersonalIncome). This is the testable half of personalIncomeLoader: the
 * server-only loader does the DB query and delegates here.
 *
 * Why route through certifyPersonalIncome: the legacy loader read only fact_type=PERSONAL_INCOME
 * and picked the highest-confidence value per (key, year). That let weak deterministic OCR
 * micro-facts (W-2 = 3, AGI = 0, TAXABLE = 456) win because the strong PERSONAL_TAX_RETURN /
 * DEAL-owned values were never even loaded for comparison. Here we certify EACH present fact_key
 * as its own semantic so the cross-owner / cross-family winner — with micro-stub dropping and
 * source-family preference — is chosen for every rendered line, while superseded / rejected /
 * system_invalidated / null facts are filtered out by the certified selector.
 *
 * No schema / route / OCR / LLM / PDF change.
 */

import {
  certifyPersonalIncome,
  type PersonalIncomeFact,
  type PersonalIncomeKeySpec,
  type CertifiedPersonalIncome,
} from "./certification/certifiedPersonalIncome";
import { GCF_PERSONAL_INCOME_COMPONENT_KEYS } from "@/lib/financialSpreads/gcfPersonalIncome";

export type PersonalIncomeYear = {
  year: number;
  periodEnd: string;
  wagesW2: number | null;
  schedCNet: number | null;
  schedENet: number | null;
  k1OrdinaryIncome: number | null;
  taxableInterest: number | null;
  ordinaryDividends: number | null;
  capitalGains: number | null;
  pensionAnnuity: number | null;
  socialSecurity: number | null;
  otherIncome: number | null;
  adjustmentsToIncome: number | null;
  adjustedGrossIncome: number | null;
  standardDeduction: number | null;
  qbiDeduction: number | null;
  taxableIncome: number | null;
  totalTax: number | null;
  schEGrossRents: number | null;
  schEMortgageInterest: number | null;
  schEDepreciation: number | null;
  schETotalExpenses: number | null;
  f4562Sec179: number | null;
  f4562BonusDepreciation: number | null;
  f4562TotalDepreciation: number | null;
  f8825NetIncomeLoss: number | null;
};

/** Per-line provenance of the value that was certified into the rendered spread. */
export type PersonalIncomeSourceTrace = {
  year: number;
  key: string;
  value: number | null;
  ownerType: string | null;
  sourceFamily: string | null;
  confidence: number | null;
};

/** A competing candidate that lost selection (weak micro-stub or weaker source). */
export type PersonalIncomeRejectionTrace = {
  year: number;
  key: string;
  value: number | null;
  ownerType: string;
  sourceFamily: string | null;
  reason: string;
};

export type PersonalIncomeAudit = {
  /** True when selection was routed through the certified cross-owner selector. */
  certified: boolean;
  /**
   * True when ONLY the legacy weak PERSONAL_INCOME family was present (no strong
   * PERSONAL_TAX_RETURN / DEAL-owned candidate). Backwards-compatibility path: values
   * pass through unchanged.
   */
  legacyOnly: boolean;
  /** True when a strong PERSONAL_TAX_RETURN-family value actually won a line. */
  hasStrongFamily: boolean;
  selectedSources: PersonalIncomeSourceTrace[];
  rejected: PersonalIncomeRejectionTrace[];
};

export type CertifiedPersonalIncomeResult = {
  years: PersonalIncomeYear[];
  audit: PersonalIncomeAudit;
};

function helper(bucket: Record<string, number>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (bucket[k] != null) return bucket[k];
  }
  return null;
}

function isStrongFamilyFact(f: PersonalIncomeFact): boolean {
  return (
    (f.fact_type ?? "").toUpperCase().includes("TAX_RETURN") ||
    (f.owner_type ?? "").toUpperCase() === "DEAL"
  );
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/**
 * Build the certified-selection audit (selected source family + dropped competitors) from a
 * CertifiedPersonalIncome result. Shared by the classic-spread loader and the GCF helper so both
 * report provenance the same way.
 */
export function buildPersonalIncomeAudit(
  certified: CertifiedPersonalIncome,
  facts: PersonalIncomeFact[],
): PersonalIncomeAudit {
  const selectedSources: PersonalIncomeSourceTrace[] = [];
  const rejected: PersonalIncomeRejectionTrace[] = [];
  let hasStrongFamily = false;

  for (const cert of certified.certifications) {
    for (const r of cert.rejected) {
      rejected.push({
        year: cert.year,
        key: cert.semantic,
        value: r.value,
        ownerType: r.ownerType,
        sourceFamily: r.sourceFamily,
        reason: r.reason,
      });
    }
    if (cert.value.status !== "certified" || cert.value.value === null) continue;
    selectedSources.push({
      year: cert.year,
      key: cert.semantic,
      value: cert.value.value,
      ownerType: cert.ownerType,
      sourceFamily: cert.sourceFamily,
      confidence: cert.value.confidence,
    });
    // The weak PERSONAL_INCOME family also carries source_canonical_type=PERSONAL_TAX_RETURN, so
    // the family LABEL can't distinguish weak from strong. The strong family is DEAL-owned, so key
    // the flag off the winner owner.
    if ((cert.ownerType ?? "").toUpperCase() === "DEAL") hasStrongFamily = true;
  }

  return {
    certified: true,
    legacyOnly: !facts.some(isStrongFamilyFact),
    hasStrongFamily,
    selectedSources,
    rejected,
  };
}

/**
 * Build the certified PersonalIncomeYear[] rows from raw candidate facts.
 *
 * Each distinct present fact_key is certified as its own semantic so the strongest source for
 * THAT key/year wins (cross-owner), with contradicted OCR micro-stubs dropped. The certified
 * per-key values then feed the same alias-priority + numbered-K1-sum row mapping the loader has
 * always used, so the rendered shape is unchanged and backwards-compatible.
 */
export function buildCertifiedPersonalIncomeYears(
  facts: PersonalIncomeFact[],
  opts?: { ownerEntityId?: string | null },
): CertifiedPersonalIncomeResult {
  // One semantic per present fact_key → per-key cross-owner certification for every line.
  const presentKeys = [...new Set(facts.map((f) => f.fact_key).filter(Boolean))];
  const keySpecs: PersonalIncomeKeySpec[] = presentKeys.map((k) => ({ semantic: k, aliases: [k] }));

  const certified = certifyPersonalIncome(facts, {
    keys: keySpecs,
    ownerEntityId: opts?.ownerEntityId ?? null,
  });

  const audit = buildPersonalIncomeAudit(certified, facts);

  const byYear = new Map<number, Record<string, number>>();
  for (const cert of certified.certifications) {
    // Stub-only / unavailable lines are left blank — never rendered as garbage.
    if (cert.value.status !== "certified" || cert.value.value === null) continue;
    if (!byYear.has(cert.year)) byYear.set(cert.year, {});
    byYear.get(cert.year)![cert.semantic] = cert.value.value;
  }

  const years: PersonalIncomeYear[] = [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, b]) => ({
      year,
      periodEnd: `${year}-12-31`,
      wagesW2: helper(b, "WAGES_W2"),
      schedCNet: helper(b, "SCHED_C_NET"),
      schedENet: helper(b, "SCHED_E_NET", "SCH_E_NET", "SCH_E_RENTAL_TOTAL", "RENTAL_INCOME_SCHED_E"),
      k1OrdinaryIncome: (() => {
        const canonical = helper(b, "K1_ORDINARY_INCOME", "SCH_E_K1_NET_TOTAL");
        if (canonical != null) return canonical;
        // Gemini primary writes multi-source K-1s as K1_ORDINARY_INCOME_2, _3, etc. Sum variants.
        const k1Keys = Object.keys(b).filter((k) => /^K1_ORDINARY_INCOME_\d+$/.test(k));
        if (k1Keys.length === 0) return null;
        const sum = k1Keys.reduce((acc, k) => acc + (b[k] ?? 0), 0);
        return sum !== 0 ? sum : null;
      })(),
      taxableInterest: helper(b, "TAXABLE_INTEREST", "INTEREST_INCOME"),
      ordinaryDividends: helper(b, "ORDINARY_DIVIDENDS", "DIVIDEND_INCOME"),
      capitalGains: helper(b, "CAPITAL_GAINS"),
      pensionAnnuity: helper(b, "PENSION_ANNUITY"),
      socialSecurity: helper(b, "SOCIAL_SECURITY"),
      otherIncome: helper(b, "OTHER_INCOME", "OTHER_INCOME_SCH1"),
      adjustmentsToIncome: helper(b, "ADJUSTMENTS_TO_INCOME"),
      adjustedGrossIncome: helper(b, "ADJUSTED_GROSS_INCOME"),
      standardDeduction: helper(b, "STANDARD_DEDUCTION"),
      qbiDeduction: helper(b, "QBI_DEDUCTION"),
      taxableIncome: helper(b, "TAXABLE_INCOME"),
      totalTax: helper(b, "TOTAL_TAX"),
      schEGrossRents: helper(b, "SCH_E_GROSS_RENTS_RECEIVED", "RENTAL_INCOME_SCHED_E"),
      schEMortgageInterest: helper(b, "SCH_E_MORTGAGE_INTEREST"),
      schEDepreciation: helper(b, "SCH_E_DEPRECIATION"),
      schETotalExpenses: helper(b, "SCH_E_TOTAL_EXPENSES"),
      f4562Sec179: helper(b, "F4562_SEC179_ELECTED"),
      f4562BonusDepreciation: helper(b, "F4562_BONUS_DEPRECIATION"),
      f4562TotalDepreciation: helper(b, "F4562_TOTAL_DEPRECIATION"),
      f8825NetIncomeLoss: helper(b, "F8825_NET_INCOME_LOSS"),
    }));

  return { years, audit };
}

/**
 * SPEC-CLASSIC-SPREAD-PERSONAL-INCOME-CROSS-OWNER-CERTIFICATION-1 (Phase 4) — GCF consolidation.
 *
 * Global Cash Flow personal income build-up, sourced from the SAME certified cross-owner
 * selection layer the classic spread uses. GCF keeps its own formula engine
 * (computeGlobalCashFlow); this only replaces its separate raw-fact selector
 * (sumGcfPersonalIncome over owner_type=PERSONAL / fact_type=PERSONAL_INCOME), so strong
 * PERSONAL_TAX_RETURN / DEAL-owned values win over weak deterministic micro-facts.
 *
 * - Certifies ONLY the K-1-excluded GCF component keys (GCF_PERSONAL_INCOME_COMPONENT_KEYS), so
 *   pass-through / K-1 income is never summed into personal income (req 9 preserved).
 * - Applies the SCH_E_RENTAL_TOTAL-over-SCH_E_NET preference to avoid double-counting rental
 *   income bundled into the combined Schedule E net figure.
 * - Candidate scoping: when ownerEntityId is given, considers that sponsor's PERSONAL facts plus
 *   (when includeDealOwned) the DEAL-owned strong family. The persist path enables includeDealOwned
 *   only for single-sponsor deals so a shared DEAL-owned fact is never double-counted across
 *   multiple sponsors.
 */
export type CertifiedGcfPersonalIncome = {
  value: number | null;
  asOf: string | null;
  components: Record<string, number>;
  audit: PersonalIncomeAudit;
};

export function buildCertifiedGcfPersonalIncome(
  facts: PersonalIncomeFact[],
  opts?: { ownerEntityId?: string | null; includeDealOwned?: boolean },
): CertifiedGcfPersonalIncome {
  const ownerEntityId = opts?.ownerEntityId ?? null;
  const includeDealOwned = opts?.includeDealOwned ?? true;

  // Scope candidates to this sponsor's PERSONAL facts plus (for cross-owner certification) the
  // DEAL-owned strong family. Deal-wide when no owner is given.
  const candidates = facts.filter((f) => {
    if (ownerEntityId == null) return true;
    if (f.owner_entity_id === ownerEntityId) return true;
    if (includeDealOwned && (f.owner_type ?? "").toUpperCase() === "DEAL") return true;
    return false;
  });

  // Certify per GCF component key. K-1 keys are intentionally ABSENT from the component list, so
  // pass-through income can never be certified or summed. No pinOwner — candidates are already
  // scoped, so DEAL-owned (null owner) strong facts are not filtered out.
  const keySpecs: PersonalIncomeKeySpec[] = GCF_PERSONAL_INCOME_COMPONENT_KEYS.map((k) => ({
    semantic: k,
    aliases: [k],
  }));
  const certified = certifyPersonalIncome(candidates, { keys: keySpecs });
  const audit = buildPersonalIncomeAudit(certified, candidates);

  // Latest certified value per component key (mirrors sumGcfPersonalIncome's latest-per-key).
  const latestByKey = new Map<string, { value: number; year: number }>();
  for (const cert of certified.certifications) {
    if (cert.value.status !== "certified" || cert.value.value === null) continue;
    const prev = latestByKey.get(cert.semantic);
    if (!prev || cert.year > prev.year) latestByKey.set(cert.semantic, { value: cert.value.value, year: cert.year });
  }

  const hasRentalTotal = latestByKey.has("SCH_E_RENTAL_TOTAL");
  let total = 0;
  let present = false;
  let asOf: string | null = null;
  const components: Record<string, number> = {};

  for (const key of GCF_PERSONAL_INCOME_COMPONENT_KEYS) {
    // Prefer explicit rental total over combined Schedule E net (K-1 contamination).
    if (key === "SCH_E_NET" && hasRentalTotal) continue;
    if (key === "SCH_E_RENTAL_TOTAL" && !hasRentalTotal) continue;
    const entry = latestByKey.get(key);
    if (!entry) continue;
    total += entry.value;
    present = true;
    components[key] = entry.value;
    asOf = maxIso(asOf, `${entry.year}-12-31`);
  }

  return { value: present ? total : null, asOf, components, audit };
}
