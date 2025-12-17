import type { CreditMemoV1, MemoSection } from "@/lib/creditMemo/creditMemoTypes";
import type { TaxSpread } from "@/lib/finance/tax/taxSpreadTypes";
import type { UnderwritingResults } from "@/lib/finance/underwriting/results";
import type { UnderwritingVerdict } from "@/lib/finance/underwriting/verdict";
import type { DocumentCoverage } from "@/lib/finance/underwriting/documentCoverage";

type BuildArgs = {
  dealId: string;
  coverage: DocumentCoverage;
  underwritingSummary: {
    dscr?: number | null;
    policyMin: number;
    flags: string[];
  };
};

export function buildCreditMemoSkeleton(args: BuildArgs): CreditMemoV1 {
  // Derive years detected from tax returns
  const yearsDetected = Object.keys(args.coverage.taxReturns).map(Number).sort();
  
  // Check if we have 1120 forms (business tax returns)
  const has1120s = Object.values(args.coverage.taxReturns).some(tr => tr.present);
  
  return {
    version: "v1",
    deal_id: args.dealId,
    generated_at: new Date().toISOString(),

    doc_coverage: {
      years_detected: yearsDetected,
      has_1120s: has1120s,
      has_pfs: args.coverage.pfs.present,
      has_financial_statement: args.coverage.businessFinancials.present,
      notes: args.coverage.recommendations,
    },

    executive_summary: {
      request_summary: "Loan request under review.",
      conclusion_headline: "Underwriting analysis in progress.",
      key_strengths: [],
      key_risks: args.coverage.missingDocuments,
    },

    underwriting_snapshot: {
      policy_min_dscr: args.underwritingSummary.policyMin,
      ads: null,
      worst_year: null,
      worst_dscr: args.underwritingSummary.dscr ?? null,
      weighted_dscr: null,
      stressed_dscr: null,
      verdict_level: "caution",
      verdict_rationale: args.underwritingSummary.flags,
    },

    sections: [],

    research: {},
  };
}

export function buildCreditMemoV1(args: {
  dealId: string;
  yearsDetected: number[];
  spreadsByYear: Record<number, TaxSpread>;
  underwritingResults: UnderwritingResults;
  verdict: UnderwritingVerdict;
  narrative: string;
  research?: CreditMemoV1["research"];
  hasPfs: boolean;
  hasFinancialStatement: boolean;
}): CreditMemoV1 {
  const {
    dealId,
    yearsDetected,
    underwritingResults: r,
    verdict,
    narrative,
    research,
    hasPfs,
    hasFinancialStatement,
  } = args;

  const sections: MemoSection[] = [];

  sections.push({
    id: "deal_summary",
    title: "Deal Summary",
    body: narrative,
    flags: r.low_confidence_years.length
      ? [`Low confidence years: ${r.low_confidence_years.join(", ")}`]
      : undefined,
  });

  sections.push({
    id: "underwriting_conclusion",
    title: "Underwriting Conclusion",
    body: verdict.headline,
    bullets: [
      ...verdict.rationale,
      ...(verdict.key_drivers.length ? [`Key drivers: ${verdict.key_drivers.join("; ")}`] : []),
      ...(verdict.mitigants.length ? [`Mitigants: ${verdict.mitigants.join("; ")}`] : []),
    ],
  });

  sections.push({
    id: "financial_analysis",
    title: "Financial Analysis",
    body:
      "Key historical underwriting metrics are summarized below. DSCR is based on provided Annual Debt Service and CFADS proxy derived from available tax return normalization.",
    bullets: [
      `Policy minimum DSCR: ${r.policy_min_dscr.toFixed(2)}x`,
      `Worst-year DSCR: ${r.worst_dscr !== null ? `${r.worst_dscr.toFixed(2)}x` : "—"}${r.worst_year ? ` (TY ${r.worst_year})` : ""}`,
      `Weighted DSCR: ${r.weighted_dscr !== null ? `${r.weighted_dscr.toFixed(2)}x` : "—"}`,
      `Stressed DSCR (CFADS -10%): ${r.stressed_dscr !== null ? `${r.stressed_dscr.toFixed(2)}x` : "—"}`,
      `CFADS trend: ${r.cfads_trend}`,
      `Revenue trend: ${r.revenue_trend}`,
    ],
    flags: r.flags.length ? r.flags.slice(0, 8) : undefined,
  });

  // Research sections (if available)
  if (research?.company?.summary || research?.company?.bullets?.length) {
    sections.push({
      id: "company_research",
      title: "Company Research",
      body: research.company?.summary ?? "",
      bullets: research.company?.bullets,
      sources: research.company?.sources,
    });
  }

  if (research?.industry?.summary || research?.industry?.bullets?.length) {
    sections.push({
      id: "industry_research",
      title: "Industry Research",
      body: research.industry?.summary ?? "",
      bullets: research.industry?.bullets,
      sources: research.industry?.sources,
    });
  }

  if (research?.owner?.summary || research?.owner?.bullets?.length) {
    sections.push({
      id: "owner_research",
      title: "Owner / Guarantor Research",
      body: research.owner?.summary ?? "",
      bullets: research.owner?.bullets,
      sources: research.owner?.sources,
    });
  }

  // Doc coverage / missing docs section
  const notes: string[] = [];
  if (!hasPfs) notes.push("PFS not detected yet (recommend upload).");
  if (!hasFinancialStatement) notes.push("Business financial statement not detected yet (recommend upload).");

  sections.push({
    id: "doc_coverage",
    title: "Document Coverage",
    body: "This section summarizes which key underwriting documents were detected.",
    bullets: [
      `Tax years detected: ${yearsDetected.length ? yearsDetected.join(", ") : "—"}`,
      `PFS detected: ${hasPfs ? "Yes" : "No"}`,
      `Financial statement detected: ${hasFinancialStatement ? "Yes" : "No"}`,
      ...notes,
    ],
  });

  return {
    version: "v1",
    deal_id: dealId,
    generated_at: new Date().toISOString(),
    doc_coverage: {
      years_detected: yearsDetected,
      has_1120s: true, // best-effort; UI can refine later
      has_pfs: hasPfs,
      has_financial_statement: hasFinancialStatement,
      notes: notes.length ? notes : undefined,
    },
    executive_summary: {
      request_summary: "TBD (wire from Deal Overview later).",
      conclusion_headline: verdict.headline,
      key_strengths: verdict.level === "approve" ? ["Coverage meets policy under current assumptions."] : [],
      key_risks: verdict.level !== "approve" ? verdict.key_drivers.slice(0, 4) : [],
    },
    underwriting_snapshot: {
      policy_min_dscr: r.policy_min_dscr,
      ads: r.annual_debt_service,
      worst_year: r.worst_year,
      worst_dscr: r.worst_dscr,
      weighted_dscr: r.weighted_dscr,
      stressed_dscr: r.stressed_dscr,
      verdict_level: verdict.level,
      verdict_rationale: verdict.rationale,
    },
    sections,
    research: research ?? {},
  };
}
