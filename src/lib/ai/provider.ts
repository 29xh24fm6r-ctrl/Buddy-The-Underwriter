import type { EvidenceRef } from "@/lib/evidence/types";
import { OpenAIProvider } from "@/lib/ai/openaiProvider";

export type RiskInput = {
  dealId: string;
  dealSnapshot: Record<string, any>;
  evidenceIndex?: Array<{ docId: string; label: string; kind: "pdf" | "text" }>;
};

export type RiskOutput = {
  grade: string; // e.g. "B+"
  baseRateBps: number; // e.g. 450
  riskPremiumBps: number; // e.g. 200
  pricingExplain: Array<{ label: string; bps: number; evidence?: EvidenceRef[]; rationale: string }>;
  factors: Array<{
    label: string;
    category: string;
    direction: "positive" | "negative" | "neutral";
    contribution: number;
    confidence: number;
    evidence: EvidenceRef[];
    rationale: string;
  }>;
};

export type MemoInput = {
  dealId: string;
  dealSnapshot: Record<string, any>;
  risk: RiskOutput;
};

export type MemoSection = {
  sectionKey: string;
  title: string;
  content: string;
  citations: EvidenceRef[];
};

export type MemoOutput = {
  sections: MemoSection[];
};

export type CommitteeAnswer = {
  answer: string;
  citations: EvidenceRef[];
  followups?: string[];
};

export interface AIProvider {
  generateRisk(input: RiskInput): Promise<RiskOutput>;
  generateMemo(input: MemoInput): Promise<MemoOutput>;
  chatAboutDeal(input: { dealId: string; question: string; dealSnapshot: Record<string, any>; risk: RiskOutput | null; memo: string | null; }): Promise<CommitteeAnswer>;
}

/**
 * STUB provider: deterministic, "demo-perfect", no network calls.
 * Replace getAIProvider() with an OpenAI adapter later.
 */
class StubProvider implements AIProvider {
  async generateRisk(input: RiskInput): Promise<RiskOutput> {
    const doc0 = input.evidenceIndex?.[0];
    const ev = (label: string, page: number): EvidenceRef => ({
      kind: "pdf",
      sourceId: doc0?.docId ?? "mock-doc",
      label: doc0?.label ?? label,
      page,
      bbox: { x: 0.12, y: 0.22, w: 0.62, h: 0.08 },
      excerpt: "…",
    });

    return {
      grade: "B+",
      baseRateBps: 450,
      riskPremiumBps: 200,
      pricingExplain: [
        { label: "Revenue volatility", bps: 75, evidence: [ev("Bank statements", 3)], rationale: "Volatility observed in monthly inflows." },
        { label: "Customer concentration", bps: 50, evidence: [ev("A/R aging", 1)], rationale: "Top customer concentration increases downside risk." },
        { label: "Collateral haircut", bps: 75, evidence: [ev("Inventory report", 2)], rationale: "Inventory liquidity warrants conservative advance rates." },
      ],
      factors: [
        {
          label: "Strong cashflow coverage (DSCR)",
          category: "cashflow",
          direction: "positive",
          contribution: +0.6,
          confidence: 0.78,
          evidence: [ev("Cashflow schedule", 4)],
          rationale: "Normalized coverage supports debt service with buffer.",
        },
        {
          label: "Revenue volatility",
          category: "cashflow",
          direction: "negative",
          contribution: -0.4,
          confidence: 0.74,
          evidence: [ev("Bank statements", 3)],
          rationale: "Monthly inflows vary materially; stress case reduces cushion.",
        },
        {
          label: "Solid collateral quality (A/R + Inventory)",
          category: "collateral",
          direction: "positive",
          contribution: +0.3,
          confidence: 0.70,
          evidence: [ev("A/R aging", 1), ev("Inventory report", 2)],
          rationale: "Collateral is diversified and reasonably liquid.",
        },
        {
          label: "Customer concentration risk",
          category: "concentration",
          direction: "negative",
          contribution: -0.2,
          confidence: 0.66,
          evidence: [ev("A/R aging", 1)],
          rationale: "Top customer exposure increases volatility in collections.",
        },
      ],
    };
  }

  async generateMemo(input: MemoInput): Promise<MemoOutput> {
    const s = input.dealSnapshot;
    const r = input.risk;

    const citations = (keys: string[]) =>
      r.factors
        .filter((f) => keys.some((k) => f.label.toLowerCase().includes(k)))
        .flatMap((f) => f.evidence);

    return {
      sections: [
        {
          sectionKey: "executive_summary",
          title: "Executive Summary",
          content:
            `Recommend approval for ${s.borrowerName ?? "Borrower"} with risk grade ${r.grade}. ` +
            `Proposed pricing: Base SOFR + ${r.baseRateBps} bps plus risk premium ${r.riskPremiumBps} bps. ` +
            `Key strengths include cashflow coverage; key risks include volatility and concentration with mitigants via collateral and covenants.`,
          citations: [...citations(["cashflow"]), ...citations(["volatility", "concentration"])].slice(0, 3),
        },
        {
          sectionKey: "borrower",
          title: "Borrower & Business Overview",
          content:
            `${s.borrowerName ?? "Borrower"} operates in ${s.industry ?? "its industry"} with ${s.yearsInBusiness ?? "multiple"} years of history. ` +
            `Primary revenue drivers and operating profile reviewed; see supporting evidence for cash receipts and aging schedules.`,
          citations: r.factors.flatMap((f) => f.evidence).slice(0, 2),
        },
        {
          sectionKey: "facility",
          title: "Proposed Facility",
          content:
            `Facility: ${s.facilityType ?? "Revolver/Term"}; Amount: ${s.requestAmount ?? "$2,500,000"}; Term: ${s.term ?? "24 months"}. ` +
            `Collateral: ${s.collateral ?? "A/R + Inventory"}.`,
          citations: [],
        },
        {
          sectionKey: "risk",
          title: "Risk Assessment",
          content:
            `Risk grade ${r.grade} reflects (i) positive cashflow coverage, offset by (ii) revenue volatility and customer concentration. ` +
            `Collateral quality provides mitigation and supports advance rates.`,
          citations: r.factors.flatMap((f) => f.evidence).slice(0, 4),
        },
        {
          sectionKey: "pricing",
          title: "Pricing Rationale",
          content:
            `Pricing is composed of base rate and incremental risk premium. ` +
            `Key adders include revenue volatility, concentration, and collateral haircut as supported by the attached schedules.`,
          citations: r.pricingExplain.flatMap((p) => p.evidence ?? []).slice(0, 3),
        },
        {
          sectionKey: "covenants",
          title: "Covenants & Conditions",
          content:
            `Recommend covenants to protect against volatility and concentration: minimum DSCR, reporting cadence, and borrowing base controls. ` +
            `Conditions include standard document delivery and ongoing collateral monitoring.`,
          citations: [],
        },
      ],
    };
  }

  async chatAboutDeal(input: { dealId: string; question: string; dealSnapshot: Record<string, any>; risk: RiskOutput | null; memo: string | null; }) {
    const q = input.question.toLowerCase();
    const factors = input.risk?.factors ?? [];
    const topNeg = factors.filter(f => f.direction === 'negative').slice(0, 2);
    const topPos = factors.filter(f => f.direction === 'positive').slice(0, 2);
    const citations = [...topNeg.flatMap(f => f.evidence), ...topPos.flatMap(f => f.evidence)].slice(0, 4);
    const answer =
      q.includes('why') || q.includes('premium') || q.includes('bps')
        ? `The risk premium is driven primarily by ${topNeg.map(f=>f.label).join(' and ') || 'identified risks'}; mitigants include ${topPos.map(f=>f.label).join(' and ') || 'strengths'}. See linked evidence.`
        : `Based on the latest risk run, the deal grades ${input.risk?.grade ?? 'N/A'} with key risks ${topNeg.map(f=>f.label).join(', ') || 'N/A'} and strengths ${topPos.map(f=>f.label).join(', ') || 'N/A'}.`;
    return {
      answer,
      citations,
      followups: [
        'What covenant mitigates the top risk?',
        'Show the evidence behind the volatility adjustment.',
        'What happens under a stress scenario?'
      ]
    };
  }
}

export function getAIProvider(): AIProvider {
  // If OPENAI_API_KEY is present, use real OpenAI; otherwise fall back to demo stub.
  if (process.env.OPENAI_API_KEY) {
    return new OpenAIProvider();
  }
  return new StubProvider();
}
