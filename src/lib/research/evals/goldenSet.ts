/**
 * Phase 81: Golden-Set Evaluation Harness
 *
 * Defines regression test cases for the research → memo pipeline.
 * Each case specifies a deal scenario with expected trust grade,
 * memo behavior, and quality thresholds.
 *
 * Run via: node --import tsx src/lib/research/evals/runGoldenSetEval.ts
 */

export type GoldenSetCategory =
  | "CRE_stabilized"
  | "CRE_transitional"
  | "operating_business"
  | "ambiguous_entity"
  | "fraud_like"
  | "low_doc"
  | "regulated_industry"
  | "edge_case_industry"
  | "legacy_regression";

export type GoldenSetCase = {
  id: string;
  name: string;
  description: string;
  /**
   * Phase 82: optional category label + real-deal identifier.
   *
   * `dealId` is intentionally null for placeholder cases — Matt (or ops)
   * populates these by copying production deal IDs. Fabricating IDs is
   * explicitly out of scope because the audit CLI and regression runner
   * key on real data.
   */
  category?: GoldenSetCategory;
  dealId?: string | null;
  /** Input to validateSubjectLock */
  subject: {
    company_name: string | null;
    naics_code: string | null;
    naics_description: string | null;
    business_description?: string | null;
    city: string | null;
    state: string | null;
    geography?: string | null;
    website?: string | null;
    dba?: string | null;
    banker_summary?: string | null;
  };
  /** Expected outcomes */
  expected: {
    subjectLockPasses: boolean;
    maxTrustGrade: "committee_grade" | "preliminary" | "manual_review_required" | "research_failed";
    memoShouldHavePending: boolean;
    memoShouldBeCommitteeEligible: boolean;
    notes: string;
  };
};

export const GOLDEN_SET: GoldenSetCase[] = [
  {
    id: "yacht-charter-regression",
    name: "Yacht Charter Failure (Regression)",
    category: "legacy_regression",
    description: "Deal with no borrower info, NAICS 999999 — must be blocked",
    subject: {
      company_name: null,
      naics_code: "999999",
      naics_description: null,
      city: null,
      state: null,
    },
    expected: {
      subjectLockPasses: false,
      maxTrustGrade: "manual_review_required",
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Mandatory regression — yacht-charter memo failure must never recur",
    },
  },
  {
    id: "clean-deal",
    name: "Clean Deal — Florida Armory",
    category: "operating_business",
    description: "Fully populated deal with strong research",
    subject: {
      company_name: "Florida Armory LLC",
      naics_code: "451110",
      naics_description: "Sporting Goods Stores",
      business_description: "Retail firearms and sporting goods dealer operating in central Florida since 2015.",
      city: "Orlando",
      state: "FL",
      website: "https://floridaarmory.com",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade",
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Gold standard — canonical memo should be fully populated",
    },
  },
  {
    id: "ambiguous-subject",
    name: "Ambiguous Subject — Common Name",
    category: "ambiguous_entity",
    description: "Company with very common name, no disambiguators",
    subject: {
      company_name: "ABC Consulting",
      naics_code: "541611",
      naics_description: "Administrative Management and General Management Consulting Services",
      city: null,
      state: null,
    },
    expected: {
      subjectLockPasses: false,
      maxTrustGrade: "preliminary",
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Geography missing — research may return wrong entity",
    },
  },
  {
    id: "low-doc-deal",
    name: "Low-Doc Deal — Early Stage",
    category: "low_doc",
    description: "Deal with basic info but no documents yet",
    subject: {
      company_name: "Meridian Dental PLLC",
      naics_code: "621210",
      naics_description: "Offices of Dentists",
      business_description: "General and cosmetic dentistry practice.",
      city: "Austin",
      state: "TX",
      banker_summary: "Existing client, acquisition of retiring dentist's practice.",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade",
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Subject lock passes but financial data missing → not committee eligible",
    },
  },
  {
    id: "strong-borrower",
    name: "Strong Borrower — Full Data",
    category: "operating_business",
    description: "Well-established borrower with complete financial package",
    subject: {
      company_name: "Samaritus Management LLC",
      naics_code: "531311",
      naics_description: "Residential Property Managers",
      business_description: "Manages 1,200-unit multifamily portfolio across Southeast Michigan.",
      city: "Southfield",
      state: "MI",
      website: "https://samaritusmanagement.com",
      dba: "Samaritus Property Group",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade",
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Full data — should produce committee-grade output",
    },
  },
  {
    id: "edge-case-industry",
    name: "Edge Case — Cannabis Adjacent",
    category: "regulated_industry",
    description: "Industry with heavy regulatory scrutiny",
    subject: {
      company_name: "GreenLeaf Wellness Inc",
      naics_code: "453998",
      naics_description: "All Other Miscellaneous Store Retailers",
      business_description: "CBD wellness products retail and e-commerce. Non-THC only.",
      city: "Denver",
      state: "CO",
      website: "https://greenleafwellness.co",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary",
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: false,
      notes: "Regulatory scrutiny industry — extra contradiction coverage needed",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Phase 82: Placeholder cases — ops populates dealId from production.
  //
  // These deliberately carry dealId: null and subject: {company_name: null}
  // so eval runs skip them until a real deal is attached. They exist to
  // (a) fix the category taxonomy, (b) pre-wire the regression runner
  // with 20+ slots, (c) force review coverage across risk classes.
  //
  // DO NOT fabricate dealIds. Copy them from production after validation.
  // ───────────────────────────────────────────────────────────────────────

  {
    id: "placeholder-cre-stabilized-01",
    name: "CRE Stabilized — Multifamily (placeholder)",
    category: "CRE_stabilized",
    dealId: null,
    description: "Stabilized multifamily property with seasoned operator. Populate from prod.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "committee_grade",
      memoShouldHavePending: false, memoShouldBeCommitteeEligible: true,
      notes: "Expect evidence coverage ≥ 0.85 and strong contradiction sourcing",
    },
  },
  {
    id: "placeholder-cre-stabilized-02",
    name: "CRE Stabilized — Retail (placeholder)",
    category: "CRE_stabilized",
    dealId: null,
    description: "Anchored retail center, long-term tenants. Populate from prod.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "committee_grade",
      memoShouldHavePending: false, memoShouldBeCommitteeEligible: true,
      notes: "Expect clean T12 rent roll, strong DSCR",
    },
  },
  {
    id: "placeholder-cre-transitional-01",
    name: "CRE Transitional — Value-Add Multifamily (placeholder)",
    category: "CRE_transitional",
    dealId: null,
    description: "Value-add multifamily mid-reposition. Pro-forma dominant.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Inference-heavy by design — should trigger Phase 82 inference panel",
    },
  },
  {
    id: "placeholder-cre-transitional-02",
    name: "CRE Transitional — Hotel Conversion (placeholder)",
    category: "CRE_transitional",
    dealId: null,
    description: "Hotel-to-multifamily conversion, construction-to-perm.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Expect weak contradiction strength absent primary-source permits",
    },
  },
  {
    id: "placeholder-operating-business-01",
    name: "Operating Business — Manufacturing (placeholder)",
    category: "operating_business",
    dealId: null,
    description: "Mid-market manufacturer, 20+ year history. Strong audited financials.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "committee_grade",
      memoShouldHavePending: false, memoShouldBeCommitteeEligible: true,
      notes: "Baseline for operating-business pipeline",
    },
  },
  {
    id: "placeholder-operating-business-02",
    name: "Operating Business — Distribution (placeholder)",
    category: "operating_business",
    dealId: null,
    description: "B2B distributor, concentrated customer base.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Customer-concentration contradiction check must be strong",
    },
  },
  {
    id: "placeholder-operating-business-03",
    name: "Operating Business — Professional Services (placeholder)",
    category: "operating_business",
    dealId: null,
    description: "Law firm or accounting practice, partner-dependent.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "committee_grade",
      memoShouldHavePending: false, memoShouldBeCommitteeEligible: true,
      notes: "Management history conflict check must reach strong",
    },
  },
  {
    id: "placeholder-ambiguous-entity-01",
    name: "Ambiguous Entity — Shared Legal Name (placeholder)",
    category: "ambiguous_entity",
    dealId: null,
    description: "Legal name collides with larger public company.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: false, maxTrustGrade: "manual_review_required",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Entity lock must fail — identity_mismatch contradiction required",
    },
  },
  {
    id: "placeholder-ambiguous-entity-02",
    name: "Ambiguous Entity — DBA Divergence (placeholder)",
    category: "ambiguous_entity",
    dealId: null,
    description: "Borrower operates under a DBA that differs from legal entity.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "dba_mismatch contradiction must be addressed",
    },
  },
  {
    id: "placeholder-fraud-like-01",
    name: "Fraud-Like — Inflated Revenue (placeholder)",
    category: "fraud_like",
    dealId: null,
    description: "Submitted financials materially diverge from public/tax signals.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "manual_review_required",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "scale_plausibility must be covered with primary sources",
    },
  },
  {
    id: "placeholder-fraud-like-02",
    name: "Fraud-Like — Undisclosed Litigation (placeholder)",
    category: "fraud_like",
    dealId: null,
    description: "Material litigation present in court records, absent from application.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "manual_review_required",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Requires court_record primary source in contradiction evidence",
    },
  },
  {
    id: "placeholder-low-doc-02",
    name: "Low-Doc — Acquisition Target (placeholder)",
    category: "low_doc",
    dealId: null,
    description: "SBA acquisition, only tax returns + seller-reported P&L.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Evidence coverage below 0.85 — expect Gate 9 downgrade",
    },
  },
  {
    id: "placeholder-regulated-industry-01",
    name: "Regulated — Healthcare Services (placeholder)",
    category: "regulated_industry",
    dealId: null,
    description: "Medical practice with licensing and payer-mix exposure.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "regulatory_vs_margin check must be addressed with regulatory_filing source",
    },
  },
  {
    id: "placeholder-regulated-industry-02",
    name: "Regulated — Financial Services (placeholder)",
    category: "regulated_industry",
    dealId: null,
    description: "RIA or broker-dealer with enforcement history.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "manual_review_required",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Requires SEC/FINRA primary sources — weak sourcing triggers Gate 10",
    },
  },
  {
    id: "placeholder-edge-case-industry-01",
    name: "Edge Case — Crypto-Adjacent (placeholder)",
    category: "edge_case_industry",
    dealId: null,
    description: "Business with crypto exposure, non-THC-level regulatory uncertainty.",
    subject: { company_name: null, naics_code: null, naics_description: null, city: null, state: null },
    expected: {
      subjectLockPasses: true, maxTrustGrade: "preliminary",
      memoShouldHavePending: true, memoShouldBeCommitteeEligible: false,
      notes: "Baseline for emerging-industry risk patterns",
    },
  },
];

/**
 * Phase 82 helper: filter golden set to cases that have a real dealId.
 * Useful for the regression runner which should skip placeholders until populated.
 */
export function getPopulatedGoldenSet(): GoldenSetCase[] {
  return GOLDEN_SET.filter((c) => typeof c.dealId === "string" && c.dealId.length > 0);
}

/**
 * Phase 82 helper: group cases by category, for coverage reporting.
 */
export function groupGoldenSetByCategory(): Record<string, GoldenSetCase[]> {
  const out: Record<string, GoldenSetCase[]> = {};
  for (const c of GOLDEN_SET) {
    const key = c.category ?? "uncategorized";
    (out[key] ??= []).push(c);
  }
  return out;
}
