// src/lib/voice/sbaAssumptionVoiceSchema.ts
// Phase BPG — Voice interview schema for SBA assumption collection.
// Schema-only: no runtime logic. The voice gateway consumes these steps
// to drive turn-by-turn audio interaction and maps captured answers back
// onto SBAAssumptions fields via the listed field paths.

export interface VoiceInterviewStep {
  id: string;
  label: string;
  intro: string;
  questions: Array<{
    prompt: string;
    expects:
      | "number"
      | "percentage"
      | "text"
      | "currency"
      | "integer"
      | "enum"
      | "list";
    enumOptions?: string[];
    // Dotted path into SBAAssumptions; arrays may use [n] indexes.
    fieldPath: string;
    helpText?: string;
    required: boolean;
  }>;
}

export const SBA_ASSUMPTION_VOICE_SCHEMA: VoiceInterviewStep[] = [
  {
    id: "revenue",
    label: "Revenue",
    intro:
      "Let's walk through how you expect revenue to grow over the next three years.",
    questions: [
      {
        prompt: "What is the name of your primary revenue stream?",
        expects: "text",
        fieldPath: "revenueStreams[0].name",
        required: true,
      },
      {
        prompt:
          "What is your current annual revenue from this stream, in dollars?",
        expects: "currency",
        fieldPath: "revenueStreams[0].baseAnnualRevenue",
        required: true,
      },
      {
        prompt:
          "What growth rate do you expect for year one? For example, say 10 for 10 percent.",
        expects: "percentage",
        fieldPath: "revenueStreams[0].growthRateYear1",
        required: true,
      },
      {
        prompt: "What about year two?",
        expects: "percentage",
        fieldPath: "revenueStreams[0].growthRateYear2",
        required: true,
      },
      {
        prompt: "And year three?",
        expects: "percentage",
        fieldPath: "revenueStreams[0].growthRateYear3",
        required: true,
      },
    ],
  },
  {
    id: "costs",
    label: "Costs",
    intro: "Now let's cover your cost structure.",
    questions: [
      {
        prompt:
          "What percentage of revenue do you expect cost of goods sold to be in year one?",
        expects: "percentage",
        fieldPath: "costAssumptions.cogsPercentYear1",
        required: true,
      },
      {
        prompt: "Same question for year two?",
        expects: "percentage",
        fieldPath: "costAssumptions.cogsPercentYear2",
        required: true,
      },
      {
        prompt: "And year three?",
        expects: "percentage",
        fieldPath: "costAssumptions.cogsPercentYear3",
        required: true,
      },
    ],
  },
  {
    id: "working_capital",
    label: "Working Capital",
    intro: "A few quick working capital questions.",
    questions: [
      {
        prompt:
          "On average, how many days does it take customers to pay you?",
        expects: "integer",
        fieldPath: "workingCapital.targetDSO",
        required: true,
      },
      {
        prompt: "How many days do you take to pay your suppliers?",
        expects: "integer",
        fieldPath: "workingCapital.targetDPO",
        required: true,
      },
      {
        prompt:
          "How many times per year do you turn over inventory? Say zero if not applicable.",
        expects: "integer",
        fieldPath: "workingCapital.inventoryTurns",
        required: false,
      },
    ],
  },
  {
    id: "loan_impact",
    label: "Loan Details",
    intro: "Let's confirm the loan request and sources of funds.",
    questions: [
      {
        prompt: "What is the total loan amount you're requesting?",
        expects: "currency",
        fieldPath: "loanImpact.loanAmount",
        required: true,
      },
      {
        prompt: "What term length in months?",
        expects: "integer",
        fieldPath: "loanImpact.termMonths",
        required: true,
      },
      {
        prompt: "What interest rate do you assume? For example, say 7.25.",
        expects: "percentage",
        fieldPath: "loanImpact.interestRate",
        required: true,
      },
      {
        prompt: "How much equity are you injecting, in dollars?",
        expects: "currency",
        fieldPath: "loanImpact.equityInjectionAmount",
        required: true,
      },
      {
        prompt:
          "Where is the equity coming from — cash savings, a 401(k) rollover, a gift, or another source?",
        expects: "enum",
        enumOptions: ["cash_savings", "401k_rollover", "gift", "other"],
        fieldPath: "loanImpact.equityInjectionSource",
        required: true,
      },
      {
        prompt:
          "Is there any seller financing? If yes, say the dollar amount. If not, say zero.",
        expects: "currency",
        fieldPath: "loanImpact.sellerFinancingAmount",
        required: true,
      },
    ],
  },
  {
    id: "management",
    label: "Management Team",
    intro: "Tell me about the management team.",
    questions: [
      {
        prompt: "What is the full name of the primary owner or CEO?",
        expects: "text",
        fieldPath: "managementTeam[0].name",
        required: true,
      },
      {
        prompt: "What title do they hold?",
        expects: "text",
        fieldPath: "managementTeam[0].title",
        required: true,
      },
      {
        prompt: "How many years of industry experience do they have?",
        expects: "integer",
        fieldPath: "managementTeam[0].yearsInIndustry",
        required: true,
      },
      {
        prompt:
          "Please give a two-sentence professional biography covering their background and relevant experience.",
        expects: "text",
        fieldPath: "managementTeam[0].bio",
        required: true,
      },
    ],
  },
  {
    id: "guarantors",
    label: "Guarantor Cash Flow",
    intro:
      "For each owner with twenty percent or more, let's capture personal cash flow.",
    questions: [
      {
        prompt:
          "What is the guarantor's annual W-2 or salary income, in dollars?",
        expects: "currency",
        fieldPath: "guarantors[0].w2_salary",
        required: true,
      },
      {
        prompt: "Monthly mortgage payment?",
        expects: "currency",
        fieldPath: "guarantors[0].mortgage_payment",
        required: true,
      },
      {
        prompt: "Monthly auto payments?",
        expects: "currency",
        fieldPath: "guarantors[0].auto_payments",
        required: true,
      },
      {
        prompt: "Monthly student loan payments? Say zero if none.",
        expects: "currency",
        fieldPath: "guarantors[0].student_loans",
        required: true,
      },
      {
        prompt: "Total monthly credit card minimum payments?",
        expects: "currency",
        fieldPath: "guarantors[0].credit_card_minimums",
        required: true,
      },
    ],
  },
];
