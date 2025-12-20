// src/lib/interview/loanKnowledge.ts

export type KnowledgeChunk = {
  id: string;
  title: string;
  tags: string[];
  content: string;
};

/**
 * Curated, controlled knowledge base for borrower education.
 * Keep it factual, general, and non-committal. Avoid underwriting promises.
 * This content is used for Q&A mode only (never for credit decisions).
 */
export const LOAN_KNOWLEDGE: KnowledgeChunk[] = [
  {
    id: "overview_loan_types",
    title: "Common business loan types",
    tags: ["overview", "term", "loc", "cre", "equipment", "sba"],
    content: [
      "Common business loan types include:",
      "• Term loan: fixed amount repaid over a set term (often used for growth, refinance, one-time needs).",
      "• Line of credit (LOC): revolving access up to a limit, typically used for working capital and liquidity.",
      "• Commercial real estate (CRE): for purchase/refi/construction of business property (owner-occupied or investment).",
      "• Equipment financing: for purchase of specific equipment; often secured by the equipment.",
      "• SBA loans: government-guaranteed programs via banks to expand access to credit (e.g., SBA 7(a), SBA 504).",
      "",
      "Exact terms depend on lender policy, collateral, cash flow, guarantors, and program rules.",
    ].join("\n"),
  },
  {
    id: "sba_7a_basics",
    title: "SBA 7(a) basics",
    tags: ["sba", "7a", "eligibility", "uses", "guarantee"],
    content: [
      "SBA 7(a) is a general-purpose SBA-guaranteed loan program offered through participating lenders.",
      "Common uses: working capital, equipment, purchase of a business, refinance of eligible debt, and sometimes real estate.",
      "SBA provides a guarantee to the lender (not a direct loan from SBA), which can help expand eligibility.",
      "Most SBA 7(a) loans require personal guarantees from owners meeting program thresholds and underwriting standards.",
      "Documentation commonly includes tax returns, financial statements, debt schedules, ownership details, and a use-of-proceeds breakdown.",
      "",
      "Eligibility depends on SBA rules (size standards, eligible industries/uses, and other requirements).",
    ].join("\n"),
  },
  {
    id: "sba_504_basics",
    title: "SBA 504 basics",
    tags: ["sba", "504", "cre", "equipment", "structure"],
    content: [
      "SBA 504 is typically used for fixed assets: owner-occupied commercial real estate and long-life equipment.",
      "It is commonly structured with a lender first-lien portion plus a CDC/SBA second-lien portion, plus borrower injection.",
      "504 often targets long-term, stable financing for fixed-asset projects and can be attractive for expansion projects.",
      "Owner-occupancy requirements apply (commonly the borrower occupies a significant portion of the property).",
      "",
      "Exact structure, eligibility, and fees depend on the project and program rules.",
    ].join("\n"),
  },
  {
    id: "cre_basics",
    title: "Commercial real estate (CRE) basics",
    tags: ["cre", "real estate", "purchase", "refi"],
    content: [
      "CRE loans are used to purchase, refinance, or sometimes construct commercial property.",
      "Lenders commonly review: property value, rent rolls (if applicable), borrower cash flow, global debt service, and collateral.",
      "Owner-occupied CRE typically focuses on business cash flow + property collateral; investment CRE focuses heavily on property income (DSCR).",
      "Down payment/injection and liquidity expectations vary by lender and deal strength.",
    ].join("\n"),
  },
  {
    id: "loc_basics",
    title: "Line of credit (LOC) basics",
    tags: ["loc", "working capital", "revolver"],
    content: [
      "A line of credit is revolving — you can draw, repay, and redraw up to a limit during the availability period.",
      "Often used for working capital, seasonal needs, AR/inventory swings, and cash flow smoothing.",
      "LOCs may be secured (e.g., A/R, inventory) or unsecured depending on credit profile.",
      "Lenders commonly review cash flow, leverage, collateral (if any), and borrowing base rules (if asset-based).",
    ].join("\n"),
  },
  {
    id: "term_basics",
    title: "Term loan basics",
    tags: ["term", "amortization", "fixed"],
    content: [
      "A term loan is a fixed principal amount repaid over a set term with an amortization schedule.",
      "Used for: growth investments, refinance of eligible debt, one-time purchases, or business acquisition financing.",
      "Lenders commonly evaluate cash flow, leverage, collateral, management experience, and guarantor strength.",
    ].join("\n"),
  },
  {
    id: "equipment_basics",
    title: "Equipment financing basics",
    tags: ["equipment", "collateral"],
    content: [
      "Equipment financing is used to purchase specific equipment and is often secured by the equipment itself.",
      "Common documents: equipment quote/invoice, vendor info, business financials, tax returns, and sometimes a schedule of existing debt.",
      "Down payment requirements vary by lender, equipment type, and borrower strength.",
    ].join("\n"),
  },
  {
    id: "docs_common",
    title: "Common documents borrowers are asked for",
    tags: ["documents", "requirements"],
    content: [
      "Common items requested during business loan intake often include:",
      "• Business tax returns (multiple years)",
      "• Personal tax returns (multiple years) for guarantors",
      "• Interim financials (P&L and balance sheet)",
      "• Debt schedule (lender, balance, payment, maturity)",
      "• Ownership breakdown",
      "• Bank statements (varies)",
      "• For CRE: property details, purchase contract, rent roll, leases, insurance, etc.",
      "• For SBA: SBA forms and program-specific disclosures",
      "",
      "Exact requests vary by loan type, size, and lender policy.",
    ].join("\n"),
  },
  {
    id: "disclaimer",
    title: "Compliance disclaimer",
    tags: ["disclaimer", "compliance"],
    content: [
      "Important: This is general educational information and not a credit decision, commitment, or legal/tax advice.",
      "Final approval and terms depend on verified documentation, lender policy, and applicable program rules.",
    ].join("\n"),
  },
];
