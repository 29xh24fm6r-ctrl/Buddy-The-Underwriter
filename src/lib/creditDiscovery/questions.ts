// src/lib/creditDiscovery/questions.ts
import { DiscoveryDomain } from "./domains";

export type DiscoveryQuestion = {
  id: string;
  domain: DiscoveryDomain;
  text: string;
  why: string; // shown to borrower optionally
  expects: "text" | "number" | "json";
  requiredKeysWritten: string[]; // keys this question intends to fill in facts
};

export const CREDIT_DISCOVERY_QUESTIONS: DiscoveryQuestion[] = [
  // Identity
  {
    id: "identity_legal",
    domain: "identity",
    text: "What is the legal name of the business, and what state is it formed in?",
    why: "We need the legal borrower entity for underwriting and documentation.",
    expects: "text",
    requiredKeysWritten: ["legal_name", "state_of_formation"],
  },
  {
    id: "identity_ein_entity_type",
    domain: "identity",
    text: "What is the business EIN and legal entity type (LLC, S-Corp, C-Corp, partnership)?",
    why: "Entity type and EIN affect tax returns required and how we underwrite cash flow.",
    expects: "text",
    requiredKeysWritten: ["ein", "entity_type"],
  },
  {
    id: "identity_operating_entity",
    domain: "identity",
    text: "Is this the operating company? If there's a holding company or real estate entity involved, describe the structure in plain English.",
    why: "We must understand who earns the income and who owns the assets/real estate.",
    expects: "text",
    requiredKeysWritten: ["operating_entity_desc"],
  },

  // Management
  {
    id: "mgmt_operator",
    domain: "management",
    text: "Who runs day-to-day operations, and what are their roles/titles?",
    why: "We evaluate management capacity and key-person risk.",
    expects: "text",
    requiredKeysWritten: ["primary_operator"],
  },
  {
    id: "mgmt_years",
    domain: "management",
    text: "How long has the business been operating, and how long has the leadership team been in this industry?",
    why: "Experience reduces operational risk and supports repayment confidence.",
    expects: "text",
    requiredKeysWritten: ["years_in_business", "industry_experience_summary"],
  },

  // Business model
  {
    id: "bm_what_sell",
    domain: "business_model",
    text: "In 2–3 sentences, what do you sell and why do customers choose you over alternatives?",
    why: "We need to understand the business model and competitive advantage.",
    expects: "text",
    requiredKeysWritten: ["what_you_sell"],
  },
  {
    id: "bm_customers",
    domain: "business_model",
    text: "Who buys from you? Any customer concentration (top 3 customers and rough % of revenue)?",
    why: "Customer concentration is a major risk factor in underwriting.",
    expects: "text",
    requiredKeysWritten: ["who_buys", "top_customers_summary"],
  },
  {
    id: "bm_seasonality",
    domain: "business_model",
    text: "Is revenue seasonal or lumpy? If yes, explain the high and low periods.",
    why: "Seasonality affects cash flow timing and debt service ability.",
    expects: "text",
    requiredKeysWritten: ["seasonality_summary"],
  },

  // Ownership
  {
    id: "own_structure",
    domain: "ownership",
    text: "Who owns the business? Please list all owners and approximate ownership percentages (direct or indirect).",
    why: "Ownership determines guarantor requirements and required personal documents.",
    expects: "text",
    requiredKeysWritten: ["ownership_structure_summary"],
  },

  // Loan request
  {
    id: "loan_amount",
    domain: "loan_request",
    text: "What loan amount are you requesting?",
    why: "The amount drives structure, collateral, and required analysis.",
    expects: "number",
    requiredKeysWritten: ["loan_amount"],
  },
  {
    id: "loan_use_of_proceeds",
    domain: "loan_request",
    text: "What will the loan proceeds be used for? Please provide line items (e.g., equipment $X, refinance $Y, working capital $Z).",
    why: "Use of proceeds must be specific for credit approval and SBA eligibility when applicable.",
    expects: "text",
    requiredKeysWritten: ["use_of_proceeds_line_items"],
  },
  {
    id: "loan_timing",
    domain: "loan_request",
    text: "When do you need the funds and what is driving the timing?",
    why: "Timing informs underwriting priority and closing plan.",
    expects: "text",
    requiredKeysWritten: ["timing_need"],
  },

  // Financials
  {
    id: "fin_trend",
    domain: "financials",
    text: "Over the last 3 years, what's been the revenue trend and profitability trend? If there were dips, what caused them?",
    why: "We underwrite repayment strength and stability.",
    expects: "text",
    requiredKeysWritten: ["revenue_trend_summary", "profitability_trend_summary"],
  },
  {
    id: "fin_debt",
    domain: "financials",
    text: "What existing business debts do you have (approximate balances and monthly payments)?",
    why: "Debt load directly impacts debt service capacity.",
    expects: "text",
    requiredKeysWritten: ["debt_summary"],
  },

  // Repayment
  {
    id: "repay_primary",
    domain: "repayment",
    text: "How will this loan be repaid? What is the primary source of repayment?",
    why: "We must identify primary repayment source before underwriting.",
    expects: "text",
    requiredKeysWritten: ["primary_repayment_source"],
  },
  {
    id: "repay_secondary",
    domain: "repayment",
    text: "If the business hits a rough patch, what is the secondary support (collateral, guarantors, outside income, liquidity)?",
    why: "Secondary and tertiary support reduce credit risk.",
    expects: "text",
    requiredKeysWritten: ["secondary_repayment_source"],
  },
  {
    id: "repay_collateral",
    domain: "repayment",
    text: "What collateral are you offering (equipment, real estate, A/R, inventory, cash, other)?",
    why: "Collateral is the key secondary repayment source.",
    expects: "text",
    requiredKeysWritten: ["collateral_offered_summary"],
  },

  // Risk
  {
    id: "risk_redflags",
    domain: "risk",
    text: "Any known issues we should be aware of (tax liens, litigation, past bankruptcy, major customer loss, or other unusual risks)?",
    why: "We prefer to surface risks early and address them directly.",
    expects: "text",
    requiredKeysWritten: ["key_risks"],
  },
  {
    id: "risk_mitigants",
    domain: "risk",
    text: "What are the biggest strengths that reduce risk (contracts, recurring revenue, strong margins, liquidity, collateral, guarantees)?",
    why: "Mitigants are as important as risks in credit decisions.",
    expects: "text",
    requiredKeysWritten: ["mitigants"],
  },
];
