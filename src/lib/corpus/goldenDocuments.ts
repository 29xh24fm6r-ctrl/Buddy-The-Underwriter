import type { CorpusDocument } from "./types";

export const GOLDEN_CORPUS: CorpusDocument[] = [
  {
    id: "samaritus_2022_1065",
    displayName: "Samaritus Management LLC — Form 1065 (2022)",
    formType: "FORM_1065",
    taxYear: 2022,
    naicsCode: "487210",
    industry: "Maritime / Charter Boats",
    groundTruth: {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
      // EBITDA computed: 325912 + 191385 + 9068 = 526365
    },
    notes:
      "First verified deal in production. Service business, no COGS. Maritime industry. Used to catch OBI-as-revenue bug in Phase 1.",
  },
  {
    id: "samaritus_2024_1065",
    displayName: "Samaritus Management LLC — Form 1065 (2024)",
    formType: "FORM_1065",
    taxYear: 2024,
    naicsCode: "487210",
    industry: "Maritime / Charter Boats",
    groundTruth: {
      GROSS_RECEIPTS: 1502871,
      COST_OF_GOODS_SOLD: 449671,
      GROSS_PROFIT: 1053200,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    },
    notes:
      "2024 return uses Line 23 for OBI (vs Line 22 in 2022). COGS present — manufacturing/service hybrid. Revenue ~88% growth YOY triggers soft trend flag.",
  },
];
