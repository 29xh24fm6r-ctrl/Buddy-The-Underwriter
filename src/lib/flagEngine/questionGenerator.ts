/**
 * Question Generator — produces professional borrower questions from flags.
 *
 * Every question:
 * 1. Professional & neutral — never accusatory
 * 2. References actual numbers, forms, years
 * 3. Self-contained — borrower knows what's asked without seeing the flag
 * 4. Actionable — tells borrower specifically what to provide
 * 5. 2-3 sentences max (plus document list if applicable)
 *
 * Pure function — no DB, no server imports.
 */

import type { SpreadFlag, BorrowerQuestion, DocumentUrgency, RecipientType } from "./types";
import { makeQuestionId, toNum, fmtDollars, fmtPct, fmt } from "./flagHelpers";
import { getRule } from "./flagRegistry";

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function generateQuestion(
  flag: Omit<SpreadFlag, "borrower_question">,
  facts: Record<string, unknown>,
): BorrowerQuestion {
  const rule = getRule(flag.trigger_type);
  const recipientType: RecipientType = rule?.recipient_type ?? "borrower";
  const urgency: DocumentUrgency = getUrgency(flag.trigger_type);
  const template = TEMPLATES[flag.trigger_type];

  let questionText: string;
  let questionContext: string;
  let documentRequested: string | undefined;
  let documentFormat: string | undefined;

  if (template) {
    const result = template(flag, facts);
    questionText = result.questionText;
    questionContext = result.questionContext;
    documentRequested = result.documentRequested;
    documentFormat = result.documentFormat;
  } else {
    // Fallback generic question
    questionText = `We identified an item requiring clarification related to ${flag.trigger_type.replace(/_/g, " ")}. Could you provide additional context or documentation?`;
    questionContext = flag.banker_detail;
  }

  return {
    question_id: makeQuestionId(flag.flag_id),
    flag_id: flag.flag_id,
    question_text: questionText,
    question_context: questionContext,
    document_requested: documentRequested,
    document_format: documentFormat,
    document_urgency: urgency,
    recipient_type: recipientType,
  };
}

// ---------------------------------------------------------------------------
// Urgency resolution
// ---------------------------------------------------------------------------

function getUrgency(triggerType: string): DocumentUrgency {
  const criticalTriggers = [
    "dscr_below_1x", "fccr_below_1x", "debt_ebitda_above_5x",
    "current_ratio_below_1x", "revenue_variance_3pct",
    "k1_orphan_entity", "qoe_total_adjustments_exceed_20pct",
    "undisclosed_contingent_liability", "provider_concentration_80pct",
    "construction_budget_missing",
  ];
  if (criticalTriggers.includes(triggerType)) return "required_before_approval";

  const closingTriggers = [
    "lease_expiring_within_loan_term", "schedule_e_missing",
    "rent_roll_missing",
  ];
  if (closingTriggers.includes(triggerType)) return "required_before_closing";

  return "preferred";
}

// ---------------------------------------------------------------------------
// Template type
// ---------------------------------------------------------------------------

type TemplateResult = {
  questionText: string;
  questionContext: string;
  documentRequested?: string;
  documentFormat?: string;
};

type TemplateFn = (
  flag: Omit<SpreadFlag, "borrower_question">,
  facts: Record<string, unknown>,
) => TemplateResult;

// ---------------------------------------------------------------------------
// Question templates
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, TemplateFn> = {
  // ── Ratio-based questions ────────────────────────────────────────────────
  dscr_below_1x: (flag, facts) => {
    const dscr = toNum(flag.observed_value) ?? toNum(facts["DSCR"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} financial analysis indicates a Debt Service Coverage Ratio of ${fmt(dscr ?? 0)}x, which is below 1.0x. Could you describe any factors not reflected in the financials — such as seasonal patterns, expected revenue increases, or one-time expenses — that may affect your cash flow capacity?`,
      questionContext: `DSCR of ${fmt(dscr ?? 0)}x means current cash flow does not fully cover debt service obligations.`,
    };
  },

  dscr_below_policy_minimum: (flag, facts) => {
    const dscr = toNum(flag.observed_value) ?? toNum(facts["DSCR"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} Debt Service Coverage Ratio of ${fmt(dscr ?? 0)}x is below our minimum threshold. Are there any anticipated changes to revenue or expenses that would improve this ratio? A brief explanation of expected near-term cash flow trends would be helpful.`,
      questionContext: `DSCR of ${fmt(dscr ?? 0)}x is below the policy minimum of 1.25x.`,
    };
  },

  dscr_two_year_decline: (flag) => {
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your Debt Service Coverage Ratio has declined over the past two years through ${yr}. Could you describe the primary factors contributing to this trend and any steps being taken to stabilize or improve cash flow coverage?`,
      questionContext: `DSCR has shown a declining trajectory, raising questions about the sustainability of debt service.`,
    };
  },

  fccr_below_1x: (flag, facts) => {
    const fccr = toNum(flag.observed_value) ?? toNum(facts["FCCR"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} Fixed Charge Coverage Ratio of ${fmt(fccr ?? 0)}x is below 1.0x, indicating that fixed obligations may exceed available cash flow. Could you clarify whether any fixed charges are expected to decrease or if there are additional income sources not reflected in the analysis?`,
      questionContext: `FCCR below 1.0x indicates insufficient cash flow to cover all fixed charges.`,
    };
  },

  debt_ebitda_above_5x: (flag, facts) => {
    const ratio = toNum(flag.observed_value) ?? toNum(facts["DEBT_TO_EBITDA"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} Debt-to-EBITDA ratio of ${fmt(ratio ?? 0)}x indicates high leverage relative to earnings. Could you outline your plan for reducing leverage, including any anticipated debt repayments, asset sales, or EBITDA growth initiatives?`,
      questionContext: `Debt/EBITDA above 5.0x is considered highly leveraged by institutional standards.`,
    };
  },

  dso_above_90: (flag, facts) => {
    const dso = toNum(flag.observed_value) ?? toNum(facts["DSO"]);
    const dsoStr = Math.round(dso ?? 0);
    return {
      questionText: `Your accounts receivable balance suggests an average collection period of approximately ${dsoStr} days. Could you describe your current collections process and whether any specific customers or invoices are contributing to elevated receivables? Please also provide your current AR aging report.`,
      questionContext: `DSO of ${dsoStr} days exceeds 90-day threshold, indicating potential collection issues.`,
      documentRequested: "Current accounts receivable aging report",
      documentFormat: "PDF or Excel",
    };
  },

  dso_increasing_15_days: (flag) => {
    const dso = toNum(flag.observed_value);
    const dsoStr = Math.round(dso ?? 0);
    return {
      questionText: `Your average collection period has increased by more than 15 days year-over-year to ${dsoStr} days. Could you explain the factors contributing to this increase and describe any changes to your collections process or credit terms?`,
      questionContext: `Rising DSO suggests deteriorating collection efficiency or changing customer payment behavior.`,
    };
  },

  current_ratio_below_1x: (flag, facts) => {
    const ratio = toNum(flag.observed_value) ?? toNum(facts["CURRENT_RATIO"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} current ratio of ${fmt(ratio ?? 0)}x indicates that current liabilities exceed current assets. Could you describe your near-term liquidity plan and whether you have any undrawn credit facilities, expected collections, or planned asset conversions that would address this?`,
      questionContext: `Current ratio below 1.0x is a significant liquidity concern.`,
    };
  },

  gross_margin_compressed_500bps: (flag) => {
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} gross profit margin has compressed by more than 500 basis points compared to the prior year. Could you describe the primary factors — such as input cost increases, pricing pressure, or product mix changes — contributing to this compression?`,
      questionContext: `Significant gross margin compression may indicate structural changes in cost or pricing dynamics.`,
    };
  },

  revenue_declining_10pct: (flag, facts) => {
    const rev = toNum(facts["TOTAL_REVENUE"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} revenue of ${rev !== null ? fmtDollars(rev) : "the reported amount"} represents a decline of more than 10% from the prior year. Could you describe the factors contributing to this decline and your outlook for revenue recovery or stabilization?`,
      questionContext: `Revenue decline exceeding 10% year-over-year raises questions about business trajectory.`,
    };
  },

  revenue_growing_margin_compressing: (flag) => {
    return {
      questionText: `While your revenue has grown, your profit margins have been compressing. Could you explain whether this reflects a deliberate strategy (e.g., market share expansion, promotional pricing) or external factors such as rising costs? Understanding the timeline for margin normalization would be helpful.`,
      questionContext: `Growing revenue with declining margins can indicate unprofitable growth or cost management issues.`,
    };
  },

  cash_conversion_cycle_above_90: (flag, facts) => {
    const ccc = toNum(flag.observed_value) ?? toNum(facts["CCC"]);
    return {
      questionText: `Your cash conversion cycle is approximately ${Math.round(ccc ?? 0)} days, indicating that cash is tied up in working capital for an extended period. Could you describe your inventory management practices and customer payment terms, and whether you anticipate any changes that would improve cash conversion?`,
      questionContext: `Cash conversion cycle above 90 days suggests significant working capital demands.`,
    };
  },

  // ── Reconciliation questions ─────────────────────────────────────────────
  revenue_variance_3pct: (flag, facts) => {
    const taxRev = toNum(facts["GROSS_RECEIPTS"]);
    const fsRev = toNum(facts["TOTAL_REVENUE"]);
    const yr = flag.year_observed ?? "";
    const taxLabel = "gross receipts";
    const fsLabel = "net revenue";
    const taxAmt = taxRev !== null ? fmtDollars(taxRev) : "the reported amount";
    const fsAmt = fsRev !== null ? fmtDollars(fsRev) : "the reported amount";
    const diff = taxRev !== null && fsRev !== null ? fmtDollars(Math.abs(taxRev - fsRev)) : "the difference";
    return {
      questionText: `Your ${yr} tax return reports ${taxLabel} of ${taxAmt}, while your ${yr} financial statements show ${fsLabel} of ${fsAmt} — a difference of ${diff}. Could you help us understand the source of this difference? If this is a timing or accounting basis difference, a brief note from your accountant confirming the reconciliation would be sufficient.`,
      questionContext: `Revenue variance between tax return and financial statements exceeds 3%, requiring explanation.`,
    };
  },

  schedule_l_variance_3pct: (flag, facts) => {
    const slAssets = toNum(facts["SL_TOTAL_ASSETS"]);
    const fsAssets = toNum(facts["TOTAL_ASSETS"]);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `The ${yr} Schedule L total assets of ${slAssets !== null ? fmtDollars(slAssets) : "the reported amount"} differs from the financial statement total assets of ${fsAssets !== null ? fmtDollars(fsAssets) : "the reported amount"}. Could you confirm whether this variance reflects timing adjustments or accounting basis differences and provide a reconciliation?`,
      questionContext: `Schedule L to financial statement balance sheet variance exceeds 3%.`,
    };
  },

  retained_earnings_rollforward_mismatch: (flag) => {
    const yr = flag.year_observed ?? "";
    return {
      questionText: `The ${yr} retained earnings balance does not reconcile with the expected rollforward (prior year ending balance plus net income less distributions). Could you provide a reconciliation of retained earnings or identify any adjustments that account for this discrepancy?`,
      questionContext: `Retained earnings rollforward mismatch may indicate unrecorded transactions or adjustments.`,
    };
  },

  k1_orphan_entity: (flag, facts) => {
    const k1Amount = toNum(facts["K1_ORDINARY_INCOME"]);
    const entityName = String(facts["K1_ENTITY_NAME"] ?? facts["K1_OWNER_NAME"] ?? "the entity");
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} personal tax return includes K-1 income of ${k1Amount !== null ? fmtDollars(k1Amount) : "the reported amount"} from ${entityName}. To complete our analysis, we need to include this entity in our review. Could you provide ${entityName}'s last 2 years of tax returns and most recent financial statements?`,
      questionContext: `K-1 income from an entity outside the current deal scope requires review for completeness.`,
      documentRequested: `${entityName} — 2 years of tax returns and most recent financial statements`,
      documentFormat: "PDF",
    };
  },

  large_other_income_5pct: (flag, facts) => {
    const amount = toNum(flag.observed_value);
    const rev = toNum(facts["TOTAL_REVENUE"]);
    const pct = amount !== null && rev !== null && rev > 0 ? fmtPct(amount / rev) : "more than 5%";
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} tax return includes ${amount !== null ? fmtDollars(amount) : "a significant amount"} of other income, which represents ${pct} of total revenue. Could you describe the source of this income and whether it is expected to recur? If this relates to a one-time event, brief documentation of that event would be helpful.`,
      questionContext: `Large other income relative to revenue needs classification as recurring or non-recurring.`,
    };
  },

  large_other_expense_5pct: (flag, facts) => {
    const amount = toNum(flag.observed_value);
    const rev = toNum(facts["TOTAL_REVENUE"]);
    const pct = amount !== null && rev !== null && rev > 0 ? fmtPct(amount / rev) : "more than 5%";
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} financials include ${amount !== null ? fmtDollars(amount) : "a significant amount"} of other deductions, representing ${pct} of total revenue. Could you provide a breakdown of the major components of this category?`,
      questionContext: `Large other expenses require itemization to ensure proper classification.`,
    };
  },

  // ── QoE questions ────────────────────────────────────────────────────────
  qoe_adjustment_low_confidence: (flag) => {
    return {
      questionText: `Our quality of earnings analysis identified adjustments with low confidence that require additional documentation. Could you provide supporting records for the items flagged — such as contracts, invoices, or board resolutions — to validate these adjustments?`,
      questionContext: `Low-confidence QoE adjustments need documentation to support their inclusion or exclusion.`,
      documentRequested: "Supporting documentation for quality of earnings adjustments",
    };
  },

  qoe_total_adjustments_exceed_20pct: (flag) => {
    return {
      questionText: `Our quality of earnings analysis resulted in total adjustments that materially change reported EBITDA (more than 20%). Could you review the attached adjustment schedule and confirm or contest each item? For any contested adjustments, please provide supporting documentation.`,
      questionContext: `Adjustments exceeding 20% of reported EBITDA indicate significant earnings quality concerns.`,
      documentRequested: "Response to quality of earnings adjustment schedule",
    };
  },

  nonrecurring_income_present: (flag, facts) => {
    const amount = toNum(flag.observed_value);
    const yr = flag.year_observed ?? "";
    return {
      questionText: `Your ${yr} financials include ${amount !== null ? fmtDollars(amount) : "an amount"} that appears to be non-recurring income. Could you confirm whether this item is expected to recur in future periods, and if so, provide documentation supporting its recurring nature?`,
      questionContext: `Non-recurring income is excluded from normalized earnings for underwriting purposes.`,
    };
  },

  // ── Trend questions ──────────────────────────────────────────────────────
  ebitda_margin_declining_2yr: (flag) => {
    return {
      questionText: `Your EBITDA margin has declined for two consecutive years. Could you describe the primary factors contributing to this trend — such as cost increases, competitive pricing pressure, or investment in growth — and your expectations for margin stabilization?`,
      questionContext: `Persistent EBITDA margin decline raises questions about the sustainability of profitability.`,
    };
  },

  revenue_declining_2yr: (flag) => {
    return {
      questionText: `Your revenue has declined for two consecutive years. Could you describe the factors driving this trend and your outlook for revenue stabilization or recovery? Information about your current sales pipeline, new customer acquisition, or market conditions would be helpful.`,
      questionContext: `Two consecutive years of revenue decline is a material risk factor requiring explanation.`,
    };
  },

  working_capital_deteriorating: (flag) => {
    return {
      questionText: `Your working capital position has deteriorated over the past two years. Could you describe the factors contributing to this trend and any planned actions to improve liquidity, such as inventory optimization, accelerated collections, or additional credit facilities?`,
      questionContext: `Declining working capital may indicate growing operational strain or liquidity pressure.`,
    };
  },

  // ── Document / structural questions ──────────────────────────────────────
  lease_expiring_within_loan_term: (flag, facts) => {
    const leaseExp = String(facts["lease_expiration_date"] ?? "the expiration date");
    const loanMat = String(facts["loan_maturity_date"] ?? "the loan maturity");
    const address = String(facts["lease_address"] ?? "the leased location");
    return {
      questionText: `We noticed your lease at ${address} expires on ${leaseExp}, which falls before the proposed loan maturity of ${loanMat}. Do you have a renewal option in place? If so, could you share the relevant lease clause or describe the anticipated renewal terms?`,
      questionContext: `Lease expiration before loan maturity creates occupancy and cash flow risk.`,
      documentRequested: "Lease agreement or renewal option documentation",
    };
  },

  customer_concentration_25pct: (flag) => {
    const pct = toNum(flag.observed_value);
    return {
      questionText: `Based on your financials, ${pct !== null ? fmtPct(pct) : "a significant portion"} of your revenue appears concentrated among a small number of customers. Could you provide a summary of your top 5 customers by annual revenue, the length of each relationship, and whether you have contracts in place? Customer concentration is a standard part of our credit review.`,
      questionContext: `Revenue concentration above 25% with any single customer creates dependency risk.`,
    };
  },

  provider_concentration_80pct: (flag) => {
    const pct = toNum(flag.observed_value);
    return {
      questionText: `Our analysis suggests that ${pct !== null ? fmtPct(pct) : "more than 80%"} of revenue is attributable to a single practitioner or provider. Could you describe any succession planning, key-person insurance, or associate development plans in place to mitigate this risk?`,
      questionContext: `Provider concentration above 80% presents key-person dependency risk.`,
    };
  },

  undisclosed_contingent_liability: (flag, facts) => {
    const amount = toNum(facts["pfs_contingent_liability_amount"]);
    return {
      questionText: `Your personal financial statement lists contingent liabilities${amount !== null ? " totaling " + fmtDollars(amount) : ""}. Could you provide details on the nature of these contingent obligations, including any pending litigation, guarantees, or letters of credit?`,
      questionContext: `Contingent liabilities must be evaluated for their potential impact on the guarantor's financial position.`,
    };
  },

  ydt_financials_stale_90_days: (flag, facts) => {
    const stmtDate = String(facts["ytd_statement_date"] ?? "the date on file");
    const today = new Date();
    const targetMonth = today.getMonth();
    const targetYear = today.getFullYear();
    const targetDate = `${targetMonth + 1}/${targetYear}`;
    return {
      questionText: `The year-to-date financial statements we have on file are dated ${stmtDate}, which are more than 90 days old. Could you provide updated financial statements through ${targetDate}? These can be internally prepared — they do not need to be accountant-reviewed.`,
      questionContext: `Stale YTD financials prevent accurate assessment of current financial condition.`,
      documentRequested: "Updated year-to-date financial statements (income statement and balance sheet)",
      documentFormat: "PDF or Excel",
    };
  },

  schedule_e_missing: (flag) => {
    const yr = flag.year_observed ?? "";
    return {
      questionText: `To complete our personal cash flow analysis, we need a copy of Schedule E from your ${yr} personal tax return. If your return was filed electronically, your accountant can provide a PDF of the complete return including all schedules.`,
      questionContext: `Schedule E is required to assess rental income and partnership pass-through income.`,
      documentRequested: `Schedule E from ${yr} personal tax return (Form 1040)`,
      documentFormat: "PDF",
    };
  },

  personal_financial_statement_stale: (flag, facts) => {
    const pfsDate = String(facts["pfs_date"] ?? "the date on file");
    return {
      questionText: `Your personal financial statement on file is dated ${pfsDate}, which is more than 90 days old. Could you provide an updated personal financial statement? Our standard form is acceptable, or you may use your own format provided it includes all assets, liabilities, and contingent obligations.`,
      questionContext: `Current personal financial statement is required for guarantor analysis.`,
      documentRequested: "Updated personal financial statement",
      documentFormat: "PDF",
    };
  },

  rent_roll_missing: (flag) => {
    return {
      questionText: `To complete our collateral analysis, we need a current rent roll for the subject property. The rent roll should include tenant names, lease start/end dates, monthly rent amounts, and any rent escalation provisions.`,
      questionContext: `Rent roll is required to validate property income and assess lease rollover risk.`,
      documentRequested: "Current rent roll for subject property",
      documentFormat: "PDF or Excel",
    };
  },

  construction_budget_missing: (flag) => {
    return {
      questionText: `For construction and renovation loans, we require a detailed construction budget including itemized costs, timeline, contingency allocation, and contractor information. Could you provide a comprehensive budget for review?`,
      questionContext: `Construction budget is required for draw management and feasibility assessment.`,
      documentRequested: "Detailed construction budget with timeline and contingency",
      documentFormat: "PDF or Excel",
    };
  },
};
