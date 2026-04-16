/**
 * Phase 81: Golden-Set Evaluation Harness
 *
 * Defines regression test cases for the research → memo pipeline.
 * Each case specifies a deal scenario with expected trust grade,
 * memo behavior, and quality thresholds.
 *
 * Run via: node --import tsx src/lib/research/evals/runGoldenSetEval.ts
 */

export type GoldenSetCase = {
  id: string;
  name: string;
  description: string;
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

  // ─────────────────────────────────────────────────────────────
  // PHASE 82: PLACEHOLDER CASES — Matt must populate dealId from production
  // Run: npm run audit:memo POPULATE_FROM_PROD_<id> <bankId>
  // to verify each case before replacing the placeholder.
  // ─────────────────────────────────────────────────────────────

  {
    id: "cre-stabilized",
    name: "CRE Stabilized — Investment Property",
    description: "Stabilized multifamily or retail, full rent roll, strong sponsor",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "531110",
      naics_description: "Lessors of Residential Buildings and Dwellings",
      business_description: "Stabilized multifamily property, full occupancy",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Full data deal — should produce committee_grade",
    },
  },
  {
    id: "cre-transitional",
    name: "CRE Transitional — Value-Add",
    description: "Value-add with lease-up risk, construction component",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "531120",
      naics_description: "Lessors of Nonresidential Buildings",
      business_description: "Office building undergoing renovation and lease-up",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Transitional — incomplete occupancy data, preliminary grade expected",
    },
  },
  {
    id: "sba-7a-service",
    name: "SBA 7(a) Service Business",
    description: "Operating service company, SBA 7(a), established web presence",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "561210",
      naics_description: "Facilities Support Services",
      business_description: "Commercial cleaning and facility maintenance",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
      website: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Clean SBA deal with good web presence",
    },
  },
  {
    id: "sba-504-owner-occupied",
    name: "SBA 504 Owner-Occupied CRE",
    description: "504 deal, 10% equity, CDC, equipment component",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "SBA 504 with full package",
    },
  },
  {
    id: "dba-mismatch",
    name: "DBA Mismatch — Legal vs. Operating Name",
    description: "Legal entity and DBA completely different — research drift risk",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      dba: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: false,
      notes: "DBA mismatch should trigger contradiction check B (dba_mismatch)",
    },
  },
  {
    id: "operating-strong-web",
    name: "Operating Company — Strong Web Presence",
    description: "Well-known regional brand, reviews, press, clear digital footprint",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
      website: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Should produce committee_grade with strong entity lock",
    },
  },
  {
    id: "hospitality-marine",
    name: "Marine / Hospitality — Niche Industry",
    description: "Charter, marina, or watercraft hospitality. Adjacent to yacht-charter failure.",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "713990",
      naics_description: "All Other Amusement and Recreation Industries",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: false,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Niche with weak public data — preliminary max, not committee",
    },
  },
  {
    id: "franchise-deal",
    name: "Franchise — Established Brand",
    description: "Named franchise, royalty structure, national franchisor, FDD available",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Franchise with strong brand — entity lock should be easy",
    },
  },
  {
    id: "healthcare-dental",
    name: "Healthcare Practice Acquisition",
    description: "Dental or medical practice, HIPAA, licensing, patient base continuity",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "621210",
      naics_description: "Offices of Dentists",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Healthcare practice acquisition",
    },
  },
  {
    id: "cannabis-adjacent",
    name: "Cannabis-Adjacent — Heavy Regulatory Scrutiny",
    description: "CBD / hemp wellness products, non-THC, compliance-heavy",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "453998",
      naics_description: "All Other Miscellaneous Store Retailers",
      business_description: "CBD wellness products, retail and e-commerce",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: false,
      notes: "Regulatory scrutiny — contradiction coverage for regulatory_vs_margin expected",
    },
  },
  {
    id: "fraud-unresolved-entity",
    name: "Unresolvable Entity — Fraud-Like Pattern",
    description: "No public records, UPS Store address, name returns nothing",
    subject: {
      company_name: "Ghost Corp LLC",
      naics_code: "999999",
      naics_description: null,
      city: null,
      state: null,
    },
    expected: {
      subjectLockPasses: false,
      maxTrustGrade: "research_failed" as const,
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Worst case — should fail hard at subject lock and produce research_failed",
    },
  },
  {
    id: "low-doc-sparse",
    name: "Low-Doc / Sparse Package",
    description: "Minimal documents, early stage intake, no spreads yet",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Sparse docs — preliminary trust, pending metrics expected",
    },
  },
  {
    id: "multi-entity-guarantors",
    name: "Multi-Entity Deal — Multiple Guarantors",
    description: "Multiple personal guarantors, multiple business entities, cross-collateral",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "committee_grade" as const,
      memoShouldHavePending: false,
      memoShouldBeCommitteeEligible: true,
      notes: "Multi-guarantor deal — Phase 82 joint filer logic should satisfy checklist",
    },
  },
  {
    id: "equipment-specialty",
    name: "Equipment / Specialty Use Case",
    description: "Niche equipment financing, limited comparables, hard to appraise",
    subject: {
      company_name: "POPULATE_FROM_PROD",
      naics_code: "POPULATE_FROM_PROD",
      naics_description: "POPULATE_FROM_PROD",
      business_description: "POPULATE_FROM_PROD",
      city: "POPULATE_FROM_PROD",
      state: "POPULATE_FROM_PROD",
    },
    expected: {
      subjectLockPasses: true,
      maxTrustGrade: "preliminary" as const,
      memoShouldHavePending: true,
      memoShouldBeCommitteeEligible: false,
      notes: "Specialty equipment — collateral adequacy will be uncertain",
    },
  },
];
