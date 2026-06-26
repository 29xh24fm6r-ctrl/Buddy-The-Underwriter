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
} from "./certification/certifiedPersonalIncome";

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

  const byYear = new Map<number, Record<string, number>>();
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
    // Stub-only / unavailable lines are left blank — never rendered as garbage.
    if (cert.value.status !== "certified" || cert.value.value === null) continue;

    if (!byYear.has(cert.year)) byYear.set(cert.year, {});
    byYear.get(cert.year)![cert.semantic] = cert.value.value;

    selectedSources.push({
      year: cert.year,
      key: cert.semantic,
      value: cert.value.value,
      ownerType: cert.ownerType,
      sourceFamily: cert.sourceFamily,
      confidence: cert.value.confidence,
    });
    // The weak PERSONAL_INCOME family also carries source_canonical_type=PERSONAL_TAX_RETURN, so
    // the family LABEL can't distinguish weak from strong. The strong family is DEAL-owned
    // (per spec: "PERSONAL_TAX_RETURN / DEAL-owned facts"), so key the flag off the winner owner.
    if ((cert.ownerType ?? "").toUpperCase() === "DEAL") hasStrongFamily = true;
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

  return {
    years,
    audit: {
      certified: true,
      legacyOnly: !facts.some(isStrongFamilyFact),
      hasStrongFamily,
      selectedSources,
      rejected,
    },
  };
}
