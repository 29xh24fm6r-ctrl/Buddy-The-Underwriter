/**
 * Phase 55 — Covenant Rule Engine (Deterministic Pass 1)
 *
 * Pure function. Same snapshot + risk grade → same thresholds, always.
 * No LLM. No DB.
 */

import { COVENANT_RULE_CONFIG, isInvestmentGrade } from "./covenantRuleConfig";
import type {
  FinancialCovenant,
  ReportingCovenant,
  BehavioralCovenant,
  SpringingCovenant,
  DealType,
  TestingFrequency,
} from "./covenantTypes";

export type RuleEngineInput = {
  riskGrade: string;
  dealType: DealType;
  actualDscr: number | null;
  actualLeverage: number | null;
  actualDebtYield: number | null;
  actualOccupancy: number | null;
  actualGlobalCashFlow: number | null;
  loanAmount: number | null;
  propertyType?: string | null;
};

export type RawCovenantSet = {
  financial: FinancialCovenant[];
  reporting: ReportingCovenant[];
  behavioral: BehavioralCovenant[];
  springing: SpringingCovenant[];
};

let nextId = 0;
function genId(): string {
  return `cov_${++nextId}_${Date.now().toString(36)}`;
}

export function runCovenantRuleEngine(input: RuleEngineInput): RawCovenantSet {
  nextId = 0;
  const cfg = COVENANT_RULE_CONFIG;
  const grade = input.riskGrade.toUpperCase();
  const invGrade = isInvestmentGrade(grade);
  const gradeKey = invGrade ? "investment_grade" : "speculative";

  const financial: FinancialCovenant[] = [];
  const reporting: ReportingCovenant[] = [];
  const behavioral: BehavioralCovenant[] = [];
  const springing: SpringingCovenant[] = [];

  // ── Financial Covenants ─────────────────────────────────────────────

  // DSCR Floor
  const baseDscrFloor = cfg.dscrFloors[grade] ?? 1.20;
  const dscrFloor =
    input.actualDscr !== null && input.actualDscr < baseDscrFloor + 0.15
      ? baseDscrFloor + 0.05
      : baseDscrFloor;

  financial.push({
    id: genId(),
    name: "DSCR Floor",
    category: "dscr",
    threshold: dscrFloor,
    unit: "ratio",
    testingFrequency: "annual",
    testingBasis: "trailing 12-month",
    draftLanguage: `Borrower shall maintain a Debt Service Coverage Ratio of not less than ${dscrFloor.toFixed(2)}x, tested annually on a trailing 12-month basis.`,
    rationale: `Based on risk grade ${grade} and current DSCR of ${input.actualDscr?.toFixed(2) ?? "N/A"}.`,
    source: "rule_engine",
    severity: "required",
  });

  // Leverage Cap
  const leverageCfg = cfg.leverageCaps[input.dealType] ?? cfg.leverageCaps.operating_company;
  const leverageCap = leverageCfg[gradeKey];

  financial.push({
    id: genId(),
    name: "Leverage Cap",
    category: "leverage",
    threshold: leverageCap,
    unit: "ratio",
    testingFrequency: "annual",
    testingBasis: "at measurement date",
    draftLanguage: `Total Debt to Tangible Net Worth shall not exceed ${leverageCap.toFixed(1)}x at any measurement date.`,
    rationale: `${input.dealType.replace(/_/g, " ")} deal at ${gradeKey.replace(/_/g, " ")} level.`,
    source: "rule_engine",
    severity: "required",
  });

  // CRE-specific: Debt Yield Floor
  if (input.dealType === "real_estate" || input.dealType === "mixed_use") {
    const propType = input.propertyType ?? "default";
    const dyFloor = cfg.debtYieldFloors[propType] ?? cfg.debtYieldFloors.default;

    financial.push({
      id: genId(),
      name: "Debt Yield Floor",
      category: "debt_yield",
      threshold: dyFloor,
      unit: "percentage",
      testingFrequency: "annual",
      testingBasis: "trailing 12-month NOI / outstanding balance",
      draftLanguage: `Net Operating Income divided by outstanding loan balance shall not be less than ${(dyFloor * 100).toFixed(1)}%, tested annually.`,
      rationale: `Property type: ${propType}.`,
      source: "rule_engine",
      severity: "required",
    });

    // Occupancy Floor
    const occFloor = cfg.occupancyFloors[propType] ?? cfg.occupancyFloors.default;
    financial.push({
      id: genId(),
      name: "Occupancy Floor",
      category: "occupancy",
      threshold: occFloor,
      unit: "percentage",
      testingFrequency: "semi_annual",
      testingBasis: "occupied / gross leasable area",
      draftLanguage: `Occupied square footage shall not fall below ${(occFloor * 100).toFixed(0)}% of gross leasable area, tested semi-annually.`,
      rationale: `Standard for ${propType} property.`,
      source: "rule_engine",
      severity: "required",
    });
  }

  // ── Reporting Covenants ─────────────────────────────────────────────

  const reportingReqs: string[] = [...cfg.reportingRequirements.base];
  if (input.dealType === "real_estate" || input.dealType === "mixed_use") {
    reportingReqs.push(...cfg.reportingRequirements.real_estate);
  }
  if (!invGrade) {
    reportingReqs.push(...cfg.reportingRequirements.speculative_grade);
  }

  const REPORTING_LABELS: Record<string, { name: string; freq: TestingFrequency; days: number; language: string }> = {
    annual_financials_120d: { name: "Annual Financial Statements", freq: "annual", days: 120, language: "CPA-prepared annual financial statements within 120 days of fiscal year end." },
    annual_guarantor_pfs: { name: "Guarantor Personal Financial Statement", freq: "annual", days: 120, language: "Annual personal financial statements and tax returns for all guarantors with > 20% ownership." },
    tax_returns: { name: "Tax Returns", freq: "annual", days: 120, language: "Federal tax returns within 30 days of filing, or by October 15 if extended." },
    quarterly_rent_rolls: { name: "Quarterly Rent Rolls", freq: "quarterly", days: 45, language: "Quarterly rent roll within 45 days of quarter end." },
    annual_appraisal_update: { name: "Annual Appraisal Update", freq: "annual", days: 90, language: "Updated appraisal or broker opinion of value annually." },
    quarterly_financials: { name: "Quarterly Financial Statements", freq: "quarterly", days: 45, language: "Management-prepared quarterly financial statements within 45 days of quarter end." },
    monthly_borrowing_base: { name: "Monthly Borrowing Base", freq: "monthly", days: 30, language: "Monthly borrowing base certificate within 30 days of month end." },
  };

  for (const req of reportingReqs) {
    const label = REPORTING_LABELS[req];
    if (!label) continue;
    reporting.push({
      id: genId(),
      name: label.name,
      requirement: req,
      frequency: label.freq,
      deadlineDays: label.days,
      draftLanguage: label.language,
      source: "rule_engine",
      severity: "required",
    });
  }

  // ── Behavioral Covenants ────────────────────────────────────────────

  behavioral.push(
    {
      id: genId(),
      name: "No Additional Senior Debt",
      covenantType: "negative",
      draftLanguage: "Borrower shall not incur additional debt senior to or pari passu with the Bank without prior written consent.",
      rationale: "Standard protection of lender priority.",
      source: "rule_engine",
      severity: "required",
    },
    {
      id: genId(),
      name: "Change of Ownership",
      covenantType: "negative",
      draftLanguage: "No transfer of ownership interest exceeding 20% without prior Bank approval, which shall not be unreasonably withheld.",
      rationale: "Preserve known sponsorship quality.",
      source: "rule_engine",
      severity: "required",
    },
    {
      id: genId(),
      name: "Insurance Maintenance",
      covenantType: "affirmative",
      draftLanguage: "Borrower shall maintain adequate insurance on all collateral, with Bank named as loss payee/additional insured.",
      rationale: "Standard collateral protection.",
      source: "rule_engine",
      severity: "required",
    },
    {
      id: genId(),
      name: "Distribution Restriction",
      covenantType: "negative",
      draftLanguage: `No distributions or dividends if DSCR is below ${(dscrFloor + 0.05).toFixed(2)}x on trailing 12-month basis.`,
      rationale: "Cash retention during thin coverage.",
      source: "rule_engine",
      severity: "recommended",
    },
  );

  // ── Springing Covenants ─────────────────────────────────────────────

  const dscrSpringTrigger = dscrFloor - cfg.springingTriggers.dscrTrigger;
  springing.push({
    id: genId(),
    name: "DSCR Cash Trap",
    triggerCondition: `DSCR falls below ${dscrSpringTrigger.toFixed(2)}x`,
    triggerThreshold: dscrSpringTrigger,
    triggerMetric: "DSCR",
    remedy: "Borrower must establish interest reserve equal to 6 months of debt service within 30 days.",
    draftLanguage: `If Debt Service Coverage Ratio falls below ${dscrSpringTrigger.toFixed(2)}x, Borrower shall establish an interest reserve equal to six (6) months of debt service within thirty (30) days.`,
    source: "rule_engine",
  });

  if (input.dealType === "real_estate" || input.dealType === "mixed_use") {
    const occFloor = cfg.occupancyFloors[input.propertyType ?? "default"] ?? cfg.occupancyFloors.default;
    const occTrigger = occFloor - cfg.springingTriggers.occupancyTrigger;
    springing.push({
      id: genId(),
      name: "Occupancy Re-Appraisal Trigger",
      triggerCondition: `Occupancy falls below ${(occTrigger * 100).toFixed(0)}%`,
      triggerThreshold: occTrigger,
      triggerMetric: "OCCUPANCY_PCT",
      remedy: "Bank may require collateral re-appraisal at Borrower's expense.",
      draftLanguage: `If occupancy falls below ${(occTrigger * 100).toFixed(0)}%, Bank may require a collateral re-appraisal at Borrower's expense.`,
      source: "rule_engine",
    });
  }

  return { financial, reporting, behavioral, springing };
}
