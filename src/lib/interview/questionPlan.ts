// src/lib/interview/questionPlan.ts
import type { AllowedFactKey } from "@/lib/interview/factKeys";
import { getRequiredFactKeys, normalizeLoanType } from "@/lib/interview/progress";

export type ConfirmableCandidate = {
  id: string;
  field_key: string;
  field_value: any;
  value_text: string | null;
  metadata?: any;
};

export type ConfirmedFact = {
  field_key: string;
  field_value: any;
  value_text: string | null;
};

export type QuestionPlanResult =
  | {
      kind: "complete";
      loan_type: string | null;
      required_keys: AllowedFactKey[];
      missing_keys: AllowedFactKey[];
      question_key: null;
      question: null;
      why: string;
      candidate_fact_id: null;
    }
  | {
      kind: "confirm_candidate";
      loan_type: string | null;
      required_keys: AllowedFactKey[];
      missing_keys: AllowedFactKey[];
      question_key: AllowedFactKey;
      question: string;
      why: string;
      candidate_fact_id: string;
    }
  | {
      kind: "ask_question";
      loan_type: string | null;
      required_keys: AllowedFactKey[];
      missing_keys: AllowedFactKey[];
      question_key: AllowedFactKey;
      question: string;
      why: string;
      candidate_fact_id: null;
    };

function displayValue(v: any, valueText?: string | null) {
  if (valueText) return valueText;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Priority order: earlier keys get asked first.
 * Keep this tight — speed matters.
 */
export const QUESTION_PRIORITY: AllowedFactKey[] = [
  "loan_type_requested",
  "requested_amount",
  "loan_purpose",
  "use_of_proceeds",

  "legal_business_name",
  "entity_type",
  "business_address",

  "best_contact_name",
  "best_contact_phone",
  "best_contact_email",

  // SBA core
  "business_start_date",
  "ein",
  "owners",
  "primary_owner_name",
  "primary_owner_percent",
  "sba_ineligible_business_flags",

  // CRE
  "real_estate_address",
  "purchase_price",
  "down_payment_amount",
  "down_payment_source",

  // financial snapshot
  "annual_revenue",
  "net_income",
  "cash_on_hand",
  "existing_debt_summary",

  // project
  "project_cost_total",
];

/**
 * Deterministic question templates per key.
 * No "probing," no psychology. Just facts.
 */
export function questionForKey(key: AllowedFactKey, loanType: string | null): string {
  switch (key) {
    case "loan_type_requested":
      return `What type of loan are you looking for (SBA 7(a), commercial real estate, line of credit, term loan, or equipment financing)?`;
    case "requested_amount":
      return `What is the total amount you're requesting?`;
    case "loan_purpose":
      return `What is the main purpose of the loan?`;
    case "use_of_proceeds":
      return `How will the loan proceeds be used? (for example: equipment, inventory, working capital, purchase of real estate)`;

    case "legal_business_name":
      return `What is the legal name of the business (exactly as it appears on tax returns or formation documents)?`;
    case "dba_name":
      return `Do you operate under a DBA (trade name)? If yes, what is it?`;
    case "entity_type":
      return `What is the business entity type (LLC, S-corp, C-corp, partnership, or sole proprietorship)?`;
    case "ein":
      return `What is the business EIN?`;
    case "business_start_date":
      return `When did the business start operations? (month/year is fine)`;
    case "business_address":
      return `What is the business address?`;

    case "owners":
      return `Who are the owners and what percent does each person own?`;
    case "primary_owner_name":
      return `Who is the primary owner (name)?`;
    case "primary_owner_percent":
      return `What percent does the primary owner own?`;

    case "best_contact_name":
      return `Who should we contact as the primary point of contact (name)?`;
    case "best_contact_phone":
      return `What is the best phone number for updates and questions?`;
    case "best_contact_email":
      return `What is the best email address for updates and document requests?`;

    case "real_estate_address":
      return `What is the property address?`;
    case "purchase_price":
      return `What is the purchase price?`;
    case "down_payment_amount":
      return `How much is the down payment?`;
    case "down_payment_source":
      return `What is the source of the down payment (cash on hand, gift, equity, etc.)?`;

    case "annual_revenue":
      return `What was your most recent annual revenue (or last 12 months)?`;
    case "net_income":
      return `What was your most recent net income?`;
    case "cash_on_hand":
      return `About how much cash does the business have on hand today?`;
    case "existing_debt_summary":
      return `Do you have existing business debt? If yes, what lenders and approximate balances?`;

    case "project_cost_total":
      return `What is the total project cost (all-in)?`;

    case "sba_ineligible_business_flags":
      return `Does your business involve any restricted SBA activities (for example: lending, gambling, speculation, adult entertainment)? If yes, which ones?`;

    default:
      // Fallback: still deterministic
      return `To complete your application, can you provide: ${key}?`;
  }
}

export function buildQuestionPlan(args: {
  confirmedByKey: Map<string, ConfirmedFact>;
  requiredKeys: AllowedFactKey[];
  candidateFacts: ConfirmableCandidate[];
  recentlyAskedKeys: Set<string>;
}): QuestionPlanResult {
  const loanTypeRaw = args.confirmedByKey.get("loan_type_requested")?.field_value;
  const loanType = normalizeLoanType(loanTypeRaw);

  const missing = args.requiredKeys.filter((k) => !args.confirmedByKey.has(k));

  if (missing.length === 0) {
    return {
      kind: "complete",
      loan_type: loanType,
      required_keys: args.requiredKeys,
      missing_keys: missing,
      question_key: null,
      question: null,
      why: "All required facts are confirmed.",
      candidate_fact_id: null,
    };
  }

  // pick next missing based on priority
  const next = missing
    .slice()
    .sort((a, b) => QUESTION_PRIORITY.indexOf(a) - QUESTION_PRIORITY.indexOf(b))[0];

  // Avoid immediate repeats if we have other missing keys
  const nonRepeated = missing
    .slice()
    .sort((a, b) => QUESTION_PRIORITY.indexOf(a) - QUESTION_PRIORITY.indexOf(b))
    .find((k) => !args.recentlyAskedKeys.has(String(k)));

  const chosen = (nonRepeated || next) as AllowedFactKey;

  // If we have a suggested candidate for this key, prefer confirmation wording
  const candidate = args.candidateFacts.find((c) => String(c.field_key) === String(chosen));

  if (candidate) {
    const val = displayValue(candidate.field_value, candidate.value_text);
    return {
      kind: "confirm_candidate",
      loan_type: loanType,
      required_keys: args.requiredKeys,
      missing_keys: missing,
      question_key: chosen,
      question: `Just to confirm, for **${chosen}** I have: **${val}**. Is that correct? If not, what should it be?`,
      why: `Missing required fact: ${chosen}. A suggested value exists, so we're confirming it.`,
      candidate_fact_id: candidate.id,
    };
  }

  return {
    kind: "ask_question",
    loan_type: loanType,
    required_keys: args.requiredKeys,
    missing_keys: missing,
    question_key: chosen,
    question: questionForKey(chosen, loanType),
    why: `Missing required fact: ${chosen}.`,
    candidate_fact_id: null,
  };
}

/**
 * Convenience: compute required keys from confirmed facts map.
 */
export function computeRequiredKeysFromConfirmed(confirmedByKey: Map<string, ConfirmedFact>): AllowedFactKey[] {
  return getRequiredFactKeys(confirmedByKey);
}
