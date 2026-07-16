/**
 * Single source of truth for which official SBA/IRS forms Buddy tracks as
 * global (bank_id-agnostic) templates. Shared by scripts/ingest-sba-templates.ts
 * (one-off/manual ingestion) and src/lib/jobs/templateStalenessChecker.ts
 * (recurring cron check) so both agree on exactly the same form list and
 * source pages — a form added to one without the other would mean the
 * cron silently never checks it, or the ingester silently never fetches it.
 */
export type TemplateSource = {
  templateKey: string;
  name: string;
  /**
   * SBA/IRS forms page for this form — NOT hardcoded to a specific PDF
   * revision. The current direct-download PDF URL is resolved from this
   * page at fetch time (never hardcode a revision from a spec doc — the
   * source page is the ground truth).
   */
  sourcePageUrl: string;
};

export const OFFICIAL_TEMPLATE_SOURCES: TemplateSource[] = [
  { templateKey: "SBA_1919", name: "SBA Form 1919 — Borrower Information Form", sourcePageUrl: "https://www.sba.gov/document/sba-form-1919-borrower-information-form" },
  { templateKey: "SBA_413", name: "SBA Form 413 — Personal Financial Statement", sourcePageUrl: "https://www.sba.gov/document/sba-form-413-personal-financial-statement" },
  { templateKey: "SBA_912", name: "SBA Form 912 — Statement of Personal History", sourcePageUrl: "https://www.sba.gov/document/sba-form-912-statement-personal-history" },
  { templateKey: "SBA_1244", name: "SBA Form 1244 — Application for Section 504 Loan", sourcePageUrl: "https://www.sba.gov/document/sba-form-1244-504-loan-application" },
  { templateKey: "SBA_159", name: "SBA Form 159 — Fee Disclosure and Compensation Agreement", sourcePageUrl: "https://www.sba.gov/document/sba-form-159-fee-disclosure-compensation-agreement" },
  { templateKey: "SBA_148", name: "SBA Form 148 — Unconditional Guarantee", sourcePageUrl: "https://www.sba.gov/document/sba-form-148-unconditional-guarantee" },
  { templateKey: "SBA_148L", name: "SBA Form 148L — Limited Guarantee", sourcePageUrl: "https://www.sba.gov/document/sba-form-148l-limited-guarantee" },
  { templateKey: "SBA_601", name: "SBA Form 601 — Agreement of Compliance", sourcePageUrl: "https://www.sba.gov/document/sba-form-601-agreement-compliance-hud-regulations" },
  { templateKey: "SBA_155", name: "SBA Form 155 — Standby Creditor's Agreement", sourcePageUrl: "https://www.sba.gov/document/sba-form-155-standby-creditors-agreement" },
  { templateKey: "IRS_4506C", name: "IRS Form 4506-C — IVES Request for Transcript of Tax Return", sourcePageUrl: "https://www.irs.gov/forms-pubs/about-form-4506-c" },
];
