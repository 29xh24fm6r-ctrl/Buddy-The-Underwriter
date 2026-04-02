/* ------------------------------------------------------------------ */
/*  Credit Lens Translator — pure computation, no DB, no IO           */
/* ------------------------------------------------------------------ */

export type CreditMetric = {
  key: string;
  value: number;
  threshold?: number;
  lenderLabel: string;
};

export type BorrowerTranslation = {
  lenderTerm: string;
  borrowerTerm: string;
  explanation: string;
  status: "strong" | "adequate" | "needs_work";
  whatItMeans: string;
  whatToDoAboutIt: string;
};

/* ------------------------------------------------------------------ */
/*  Translation dictionary                                             */
/* ------------------------------------------------------------------ */

type TranslationEntry = {
  borrowerTerm: string;
  explanation: string;
  whatItMeans: (value: number, threshold?: number) => string;
  whatToDoAboutIt: (value: number, threshold?: number) => string;
  /** Return status based on value vs threshold */
  deriveStatus: (value: number, threshold?: number) => "strong" | "adequate" | "needs_work";
};

const TRANSLATIONS: Record<string, TranslationEntry> = {
  dscr: {
    borrowerTerm: "Loan Payment Coverage",
    explanation:
      "This measures how much income your business generates compared to what you owe in loan payments. Think of it as: for every $1 in loan payments, how many dollars of income do you have?",
    whatItMeans: (v, t) =>
      v >= (t ?? 1.25)
        ? `At ${v.toFixed(2)}x, your business earns well above what is needed to cover loan payments. Lenders see this as a strong sign.`
        : v >= 1.0
          ? `At ${v.toFixed(2)}x, you are covering your loan payments, but the cushion is thin. A small dip in income could make payments tight.`
          : `At ${v.toFixed(2)}x, your income does not fully cover loan payments right now. This is the top priority to address.`,
    whatToDoAboutIt: (v, t) =>
      v >= (t ?? 1.25)
        ? "Keep doing what you are doing. Maintain revenue and expense discipline."
        : "Focus on increasing income or reducing expenses. Even small improvements here make a big difference to lenders.",
    deriveStatus: (v, t) =>
      v >= (t ?? 1.25) ? "strong" : v >= 1.0 ? "adequate" : "needs_work",
  },
  ltv: {
    borrowerTerm: "How Much You're Borrowing vs Property Value",
    explanation:
      "This compares the loan amount to the value of the property or collateral. A lower number means you have more equity — more skin in the game.",
    whatItMeans: (v, t) =>
      v <= (t ?? 0.75)
        ? `At ${(v * 100).toFixed(0)}%, you have significant equity in the property. Lenders view this favorably.`
        : v <= 0.85
          ? `At ${(v * 100).toFixed(0)}%, your equity cushion is moderate. It meets basic requirements but leaves limited room.`
          : `At ${(v * 100).toFixed(0)}%, you are borrowing a high percentage of the property value. A larger down payment or additional collateral would strengthen your position.`,
    whatToDoAboutIt: (v, t) =>
      v <= (t ?? 0.75)
        ? "Your equity position is solid. No immediate action needed."
        : "Consider whether you can increase your down payment or offer additional collateral to bring this ratio down.",
    deriveStatus: (v, t) =>
      v <= (t ?? 0.75) ? "strong" : v <= 0.85 ? "adequate" : "needs_work",
  },
  current_ratio: {
    borrowerTerm: "Short-Term Financial Cushion",
    explanation:
      "This compares the cash and assets you can use quickly (within a year) to the bills you need to pay soon. It shows whether you can handle short-term obligations without stress.",
    whatItMeans: (v, t) =>
      v >= (t ?? 1.5)
        ? `At ${v.toFixed(2)}x, you have a healthy cushion of liquid assets above your near-term obligations.`
        : v >= 1.0
          ? `At ${v.toFixed(2)}x, you can cover near-term bills, but there is not much buffer for surprises.`
          : `At ${v.toFixed(2)}x, your short-term obligations exceed your liquid assets. This creates risk if unexpected expenses arise.`,
    whatToDoAboutIt: (v, t) =>
      v >= (t ?? 1.5)
        ? "Your short-term position is healthy. Continue maintaining cash reserves."
        : "Focus on building cash reserves: collect receivables faster, manage inventory levels, and delay non-urgent payments if possible.",
    deriveStatus: (v, t) =>
      v >= (t ?? 1.5) ? "strong" : v >= 1.0 ? "adequate" : "needs_work",
  },
  leverage: {
    borrowerTerm: "Total Borrowing Level",
    explanation:
      "This shows how much of your business is funded by debt versus your own money (equity). Lower leverage means less reliance on borrowed money.",
    whatItMeans: (v, t) =>
      v <= (t ?? 3.0)
        ? `At ${v.toFixed(2)}x, your borrowing is well-balanced relative to the equity in your business.`
        : v <= 5.0
          ? `At ${v.toFixed(2)}x, your business carries a moderate amount of debt. Lenders will watch this closely.`
          : `At ${v.toFixed(2)}x, your business is highly leveraged. Reducing total debt should be a priority.`,
    whatToDoAboutIt: (v, t) =>
      v <= (t ?? 3.0)
        ? "Your leverage is manageable. Avoid taking on additional debt unless it clearly supports growth."
        : "Work toward paying down existing debt and retaining more earnings in the business to build equity.",
    deriveStatus: (v, t) =>
      v <= (t ?? 3.0) ? "strong" : v <= 5.0 ? "adequate" : "needs_work",
  },
  debt_yield: {
    borrowerTerm: "Income as a Percentage of the Loan",
    explanation:
      "This shows what percentage of the loan amount is covered by annual net operating income. Higher is better — it means the property earns more relative to what you are borrowing.",
    whatItMeans: (v, t) =>
      v >= (t ?? 0.1)
        ? `At ${(v * 100).toFixed(1)}%, the property generates strong income relative to the loan amount.`
        : `At ${(v * 100).toFixed(1)}%, income relative to the loan is below target. Improving NOI or reducing the loan amount would help.`,
    whatToDoAboutIt: (v, t) =>
      v >= (t ?? 0.1)
        ? "Your debt yield is solid. Focus on maintaining income levels."
        : "Increase property income through occupancy or rent improvements, or consider requesting a smaller loan amount.",
    deriveStatus: (v, t) =>
      v >= (t ?? 0.1) ? "strong" : v >= (t ?? 0.1) * 0.85 ? "adequate" : "needs_work",
  },
  gross_margin: {
    borrowerTerm: "Profit on Each Dollar of Sales",
    explanation:
      "After paying for the direct costs of what you sell, this is how much of each revenue dollar remains. It is the starting point for covering everything else — rent, salaries, loan payments.",
    whatItMeans: (v, t) =>
      v >= (t ?? 0.4)
        ? `At ${(v * 100).toFixed(0)}%, you retain a healthy portion of each dollar earned after direct costs.`
        : `At ${(v * 100).toFixed(0)}%, your margins are thin. Small changes in costs or pricing could have an outsized impact.`,
    whatToDoAboutIt: (v, t) =>
      v >= (t ?? 0.4)
        ? "Your margins are healthy. Keep monitoring supplier costs and pricing."
        : "Review your pricing and direct costs. Even a small improvement in margin compounds across all your revenue.",
    deriveStatus: (v, t) =>
      v >= (t ?? 0.4) ? "strong" : v >= 0.2 ? "adequate" : "needs_work",
  },
  net_margin: {
    borrowerTerm: "What You Actually Keep",
    explanation:
      "After all expenses — operating costs, interest, taxes — this is what percentage of revenue becomes actual profit. It is the bottom line.",
    whatItMeans: (v, t) =>
      v >= (t ?? 0.1)
        ? `At ${(v * 100).toFixed(1)}%, your business retains a meaningful profit from its operations.`
        : `At ${(v * 100).toFixed(1)}%, very little revenue makes it to the bottom line. This limits your ability to build reserves and service debt.`,
    whatToDoAboutIt: (v, t) =>
      v >= (t ?? 0.1)
        ? "Continue managing expenses carefully and reinvesting appropriately."
        : "Audit every expense category. Focus on the largest cost lines first — even small percentage reductions make a meaningful difference.",
    deriveStatus: (v, t) =>
      v >= (t ?? 0.1) ? "strong" : v >= 0.03 ? "adequate" : "needs_work",
  },
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function translateForBorrower(
  metrics: CreditMetric[],
): BorrowerTranslation[] {
  return metrics.map((m) => {
    const entry = TRANSLATIONS[m.key];

    if (!entry) {
      // Fallback for unknown metrics
      return {
        lenderTerm: m.lenderLabel,
        borrowerTerm: m.lenderLabel,
        explanation: `This is a financial metric (${m.lenderLabel}) that lenders use to evaluate your loan application.`,
        status: m.threshold !== undefined && m.value >= m.threshold ? "strong" as const : "adequate" as const,
        whatItMeans: `Your current value is ${m.value}.`,
        whatToDoAboutIt:
          "Ask your lender or advisor to explain what this means for your specific situation.",
      };
    }

    return {
      lenderTerm: m.lenderLabel,
      borrowerTerm: entry.borrowerTerm,
      explanation: entry.explanation,
      status: entry.deriveStatus(m.value, m.threshold),
      whatItMeans: entry.whatItMeans(m.value, m.threshold),
      whatToDoAboutIt: entry.whatToDoAboutIt(m.value, m.threshold),
    };
  });
}
