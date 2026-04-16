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
];
