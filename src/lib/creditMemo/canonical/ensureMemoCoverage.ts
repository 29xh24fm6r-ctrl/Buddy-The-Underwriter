import type { MemoOutput, MemoSection, RiskOutput } from "@/lib/ai/provider";

const REQUIRED_SECTION_KEYS = [
  "executive_summary",
  "borrower_background",
  "business_description",
  "repayment_analysis",
  "risk_factors",
  "recommendation",
] as const;

export const REQUIRED_CANONICAL_MEMO_SECTIONS = [...REQUIRED_SECTION_KEYS];

type Snapshot = Record<string, unknown>;

function display(value: unknown, fallback = "not established in the current file"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function money(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value)
    : "not established in the current file";
}

function evidence(risk: RiskOutput, direction?: "positive" | "negative") {
  return risk.factors
    .filter((factor) => !direction || factor.direction === direction)
    .flatMap((factor) => factor.evidence ?? [])
    .slice(0, 4);
}

function fallbackSection(key: (typeof REQUIRED_SECTION_KEYS)[number], snapshot: Snapshot, risk: RiskOutput): MemoSection {
  const borrower = display(snapshot.legalName ?? snapshot.borrowerName, "The borrower");
  const industry = display(snapshot.naicsDescription ?? snapshot.industry, "the documented operating industry");
  const loanAmount = money(snapshot.loanAmount ?? snapshot.requestAmount);
  const revenue = money(snapshot.revenue);
  const ebitda = money(snapshot.ebitda);
  const dscr = display(snapshot.dscr);
  const negative = risk.factors.filter((factor) => factor.direction === "negative").map((factor) => factor.label);
  const positive = risk.factors.filter((factor) => factor.direction === "positive").map((factor) => factor.label);

  const sections: Record<(typeof REQUIRED_SECTION_KEYS)[number], MemoSection> = {
    executive_summary: {
      sectionKey: key,
      title: "Executive Summary",
      content: `${borrower} requests ${loanAmount} and carries the current model risk grade ${risk.grade}. The underwriting record identifies ${positive.join(", ") || "documented operating strengths"} as principal strengths and ${negative.join(", ") || "the risks described elsewhere in this memorandum"} as principal risks. Any recommendation remains subject to verification of source documents, repayment capacity, collateral, eligibility, and closing conditions.`,
      citations: [...evidence(risk, "positive"), ...evidence(risk, "negative")].slice(0, 4),
    },
    borrower_background: {
      sectionKey: key,
      title: "Borrower Background",
      content: `${borrower} operates in ${industry}. The current file identifies the requested facility as ${loanAmount}. This section intentionally limits itself to facts available in the canonical deal record; ownership history, management tenure, guarantor experience, and any unresolved identity details must be confirmed from borrower submissions before final credit approval or committee circulation.`,
      citations: evidence(risk),
    },
    business_description: {
      sectionKey: key,
      title: "Business Description",
      content: `${borrower} is evaluated within ${industry}. Reported annual revenue is ${revenue}, while EBITDA is ${ebitda}. These figures are presented as underwriting inputs rather than independently audited results. The credit file should reconcile operating history, customer concentration, revenue durability, and the proposed use of proceeds to the source documents before reliance on this description.`,
      citations: evidence(risk),
    },
    repayment_analysis: {
      sectionKey: key,
      title: "Repayment Analysis",
      content: `Primary repayment is expected from operating cash flow. The current canonical snapshot reports revenue of ${revenue}, EBITDA of ${ebitda}, and DSCR of ${dscr}. The model assigns risk grade ${risk.grade}; its supporting factors and stress assumptions must be read with the financial spread. Approval should require reconciliation of debt service, normalized cash flow, and downside coverage to certified inputs.`,
      citations: [...evidence(risk, "positive"), ...evidence(risk, "negative")].slice(0, 4),
    },
    risk_factors: {
      sectionKey: key,
      title: "Risk Factors and Mitigants",
      content: `The principal modeled risks are ${negative.join(", ") || "those identified in the underwriting assessment"}. Documented offsets include ${positive.join(", ") || "the strengths identified in the underwriting assessment"}. These mitigants do not eliminate the need for source-document validation, covenant testing, collateral confirmation, and resolution of open underwriting conditions before the credit decision becomes final.`,
      citations: [...evidence(risk, "negative"), ...evidence(risk, "positive")].slice(0, 4),
    },
    recommendation: {
      sectionKey: key,
      title: "Recommendation and Conditions",
      content: `Proceed only on a conditional underwriting basis at the current model grade of ${risk.grade}. Final approval should require verified financial inputs, satisfactory repayment and downside coverage, acceptable collateral and lien position, completion of identity and eligibility checks, resolution of all material exceptions, and confirmation that pricing and structure remain consistent with policy and the final certified spread.`,
      citations: evidence(risk),
    },
  };

  return sections[key];
}

/**
 * Converts a variable model response into the minimum canonical committee
 * narrative contract. Existing substantive model sections win; missing or
 * empty required sections are completed from the same deterministic snapshot
 * and risk output supplied to the model. No new financial calculation occurs.
 */
export function ensureMemoCoverage(memo: MemoOutput, snapshot: Snapshot, risk: RiskOutput): MemoOutput {
  const byKey = new Map<string, MemoSection>();
  for (const section of memo.sections ?? []) {
    if (!section?.sectionKey || !section.content?.trim()) continue;
    if (!byKey.has(section.sectionKey)) byKey.set(section.sectionKey, section);
  }

  for (const key of REQUIRED_SECTION_KEYS) {
    if (!byKey.has(key)) byKey.set(key, fallbackSection(key, snapshot, risk));
  }

  const required = REQUIRED_SECTION_KEYS.map((key) => byKey.get(key) as MemoSection);
  const extras = Array.from(byKey.values()).filter(
    (section) => !REQUIRED_SECTION_KEYS.includes(section.sectionKey as (typeof REQUIRED_SECTION_KEYS)[number]),
  );
  return { sections: [...required, ...extras] };
}
