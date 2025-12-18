// src/lib/sba7a/questions.ts
// Comprehensive SBA 7(a) question definitions for borrower wizard

export type QuestionType = 
  | 'TEXT' 
  | 'NUMBER' 
  | 'BOOLEAN' 
  | 'SELECT' 
  | 'MULTI_SELECT' 
  | 'CURRENCY' 
  | 'PERCENT'
  | 'DATE'
  | 'PHONE'
  | 'EMAIL'
  | 'EIN';

export type QuestionSection = 
  | 'BUSINESS_BASICS'
  | 'LOAN_REQUEST'
  | 'USE_OF_PROCEEDS'
  | 'OWNERSHIP'
  | 'AFFILIATES'
  | 'OPERATIONS'
  | 'FEDERAL_COMPLIANCE'
  | 'CHARACTER'
  | 'FINANCIALS'
  | 'COLLATERAL';

export type SBAQuestion = {
  key: string;
  section: QuestionSection;
  question: string;
  type: QuestionType;
  required: boolean;
  gatesAffected: string[]; // Which eligibility gates this affects
  sopReference?: string; // SBA SOP citation
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
  conditionalOn?: {
    questionKey: string;
    value: any;
  };
};

/**
 * SBA 7(a) Comprehensive Question Set
 * Based on SBA SOP 50 10 6 requirements
 */
export const SBA_QUESTIONS: SBAQuestion[] = [
  // ================================================================
  // SECTION: BUSINESS BASICS
  // ================================================================
  {
    key: 'business_name',
    section: 'BUSINESS_BASICS',
    question: 'Legal business name',
    type: 'TEXT',
    required: true,
    gatesAffected: [],
    helpText: 'Exact legal name as it appears on formation documents',
  },
  {
    key: 'ein',
    section: 'BUSINESS_BASICS',
    question: 'Federal Employer Identification Number (EIN)',
    type: 'EIN',
    required: true,
    gatesAffected: [],
    helpText: 'Format: XX-XXXXXXX',
    validation: {
      pattern: '^\\d{2}-\\d{7}$',
    },
  },
  {
    key: 'business_type',
    section: 'BUSINESS_BASICS',
    question: 'Legal business structure',
    type: 'SELECT',
    required: true,
    gatesAffected: ['For-Profit Requirement'],
    options: [
      { value: 'LLC', label: 'Limited Liability Company (LLC)' },
      { value: 'CORPORATION', label: 'Corporation (C-Corp or S-Corp)' },
      { value: 'PARTNERSHIP', label: 'Partnership' },
      { value: 'SOLE_PROP', label: 'Sole Proprietorship' },
      { value: 'NONPROFIT', label: 'Nonprofit Organization' },
    ],
  },
  {
    key: 'is_for_profit',
    section: 'BUSINESS_BASICS',
    question: 'Is this a for-profit business?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['For-Profit Requirement'],
    sopReference: 'SOP 50 10 6 - II.A.1',
    helpText: 'SBA loans are only available to for-profit businesses',
  },
  {
    key: 'naics_code',
    section: 'BUSINESS_BASICS',
    question: 'Primary NAICS code (if known)',
    type: 'TEXT',
    required: false,
    gatesAffected: ['Size Standards', 'Prohibited Business Types'],
    helpText: '6-digit industry classification code',
    validation: {
      pattern: '^\\d{6}$',
    },
  },
  {
    key: 'business_industry',
    section: 'BUSINESS_BASICS',
    question: 'Primary industry / business activity',
    type: 'TEXT',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    helpText: 'e.g., Restaurant, Manufacturing, Retail, Professional Services',
  },
  {
    key: 'date_established',
    section: 'BUSINESS_BASICS',
    question: 'Date business was established',
    type: 'DATE',
    required: true,
    gatesAffected: [],
    helpText: 'Date of formation or first day of operations',
  },
  {
    key: 'is_startup',
    section: 'BUSINESS_BASICS',
    question: 'Is this a startup (less than 2 years operating)?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: [],
    helpText: 'Startups may have additional requirements',
  },
  {
    key: 'is_franchise',
    section: 'BUSINESS_BASICS',
    question: 'Is this a franchise?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: [],
    sopReference: 'SOP 50 10 6 - II.C.5',
  },
  {
    key: 'franchise_name',
    section: 'BUSINESS_BASICS',
    question: 'Franchise brand name',
    type: 'TEXT',
    required: true,
    gatesAffected: [],
    conditionalOn: {
      questionKey: 'is_franchise',
      value: true,
    },
  },
  {
    key: 'annual_revenue',
    section: 'BUSINESS_BASICS',
    question: 'Most recent annual revenue',
    type: 'CURRENCY',
    required: true,
    gatesAffected: ['Size Standards'],
    sopReference: 'SOP 50 10 6 - II.A.2',
    helpText: 'Total gross receipts for most recent fiscal year',
  },
  {
    key: 'num_employees',
    section: 'BUSINESS_BASICS',
    question: 'Number of employees (including owners)',
    type: 'NUMBER',
    required: true,
    gatesAffected: ['Size Standards'],
    sopReference: 'SOP 50 10 6 - II.A.2',
    helpText: 'Full-time equivalent count',
  },
  
  // ================================================================
  // SECTION: LOCATION & OPERATIONS
  // ================================================================
  {
    key: 'is_us_based',
    section: 'OPERATIONS',
    question: 'Is the business located and operating in the United States?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['US-Based Requirement'],
    sopReference: 'SOP 50 10 6 - II.A.3',
    helpText: 'Business must be located in the US or its territories',
  },
  {
    key: 'primary_state',
    section: 'OPERATIONS',
    question: 'Primary state of operations',
    type: 'SELECT',
    required: true,
    gatesAffected: [],
    options: [
      { value: 'AL', label: 'Alabama' },
      { value: 'AK', label: 'Alaska' },
      { value: 'AZ', label: 'Arizona' },
      { value: 'AR', label: 'Arkansas' },
      { value: 'CA', label: 'California' },
      { value: 'CO', label: 'Colorado' },
      { value: 'CT', label: 'Connecticut' },
      { value: 'DE', label: 'Delaware' },
      { value: 'FL', label: 'Florida' },
      { value: 'GA', label: 'Georgia' },
      { value: 'HI', label: 'Hawaii' },
      { value: 'ID', label: 'Idaho' },
      { value: 'IL', label: 'Illinois' },
      { value: 'IN', label: 'Indiana' },
      { value: 'IA', label: 'Iowa' },
      { value: 'KS', label: 'Kansas' },
      { value: 'KY', label: 'Kentucky' },
      { value: 'LA', label: 'Louisiana' },
      { value: 'ME', label: 'Maine' },
      { value: 'MD', label: 'Maryland' },
      { value: 'MA', label: 'Massachusetts' },
      { value: 'MI', label: 'Michigan' },
      { value: 'MN', label: 'Minnesota' },
      { value: 'MS', label: 'Mississippi' },
      { value: 'MO', label: 'Missouri' },
      { value: 'MT', label: 'Montana' },
      { value: 'NE', label: 'Nebraska' },
      { value: 'NV', label: 'Nevada' },
      { value: 'NH', label: 'New Hampshire' },
      { value: 'NJ', label: 'New Jersey' },
      { value: 'NM', label: 'New Mexico' },
      { value: 'NY', label: 'New York' },
      { value: 'NC', label: 'North Carolina' },
      { value: 'ND', label: 'North Dakota' },
      { value: 'OH', label: 'Ohio' },
      { value: 'OK', label: 'Oklahoma' },
      { value: 'OR', label: 'Oregon' },
      { value: 'PA', label: 'Pennsylvania' },
      { value: 'RI', label: 'Rhode Island' },
      { value: 'SC', label: 'South Carolina' },
      { value: 'SD', label: 'South Dakota' },
      { value: 'TN', label: 'Tennessee' },
      { value: 'TX', label: 'Texas' },
      { value: 'UT', label: 'Utah' },
      { value: 'VT', label: 'Vermont' },
      { value: 'VA', label: 'Virginia' },
      { value: 'WA', label: 'Washington' },
      { value: 'WV', label: 'West Virginia' },
      { value: 'WI', label: 'Wisconsin' },
      { value: 'WY', label: 'Wyoming' },
    ],
  },
  
  // ================================================================
  // SECTION: LOAN REQUEST
  // ================================================================
  {
    key: 'loan_amount',
    section: 'LOAN_REQUEST',
    question: 'Total loan amount requested',
    type: 'CURRENCY',
    required: true,
    gatesAffected: ['Loan Amount Limit'],
    sopReference: 'SOP 50 10 6 - I.A',
    helpText: 'Maximum SBA 7(a) loan is $5,000,000',
    validation: {
      min: 1,
      max: 5_000_000,
    },
  },
  {
    key: 'loan_purpose',
    section: 'LOAN_REQUEST',
    question: 'Primary purpose of loan',
    type: 'SELECT',
    required: true,
    gatesAffected: ['Use of Proceeds'],
    options: [
      { value: 'WORKING_CAPITAL', label: 'Working Capital' },
      { value: 'EQUIPMENT', label: 'Equipment Purchase' },
      { value: 'REAL_ESTATE', label: 'Real Estate Purchase' },
      { value: 'ACQUISITION', label: 'Business Acquisition' },
      { value: 'REFINANCE', label: 'Debt Refinance' },
      { value: 'EXPANSION', label: 'Business Expansion' },
      { value: 'CONSTRUCTION', label: 'Construction / Renovation' },
    ],
  },
  
  // ================================================================
  // SECTION: USE OF PROCEEDS
  // ================================================================
  {
    key: 'use_working_capital',
    section: 'USE_OF_PROCEEDS',
    question: 'Amount for working capital',
    type: 'CURRENCY',
    required: false,
    gatesAffected: ['Use of Proceeds'],
    helpText: 'Inventory, payroll, operating expenses',
  },
  {
    key: 'use_equipment',
    section: 'USE_OF_PROCEEDS',
    question: 'Amount for equipment purchase',
    type: 'CURRENCY',
    required: false,
    gatesAffected: ['Use of Proceeds'],
  },
  {
    key: 'use_real_estate',
    section: 'USE_OF_PROCEEDS',
    question: 'Amount for real estate',
    type: 'CURRENCY',
    required: false,
    gatesAffected: ['Use of Proceeds'],
  },
  {
    key: 'use_acquisition',
    section: 'USE_OF_PROCEEDS',
    question: 'Amount for business acquisition',
    type: 'CURRENCY',
    required: false,
    gatesAffected: ['Use of Proceeds'],
  },
  {
    key: 'use_refinance',
    section: 'USE_OF_PROCEEDS',
    question: 'Amount for debt refinance',
    type: 'CURRENCY',
    required: false,
    gatesAffected: ['Use of Proceeds'],
    sopReference: 'SOP 50 10 6 - III.E',
  },
  
  // ================================================================
  // SECTION: PROHIBITED BUSINESS TYPES
  // ================================================================
  {
    key: 'is_gambling_business',
    section: 'OPERATIONS',
    question: 'Is gambling or gaming a primary business activity?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    sopReference: 'SOP 50 10 6 - II.C.2',
    helpText: 'Casinos, betting, lottery operations are ineligible',
  },
  {
    key: 'is_lending_business',
    section: 'OPERATIONS',
    question: 'Is lending or financial investment a primary business activity?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    sopReference: 'SOP 50 10 6 - II.C.2',
    helpText: 'Banks, finance companies, investment firms are ineligible',
  },
  {
    key: 'is_real_estate_investment',
    section: 'OPERATIONS',
    question: 'Is passive real estate investment a primary business activity?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    sopReference: 'SOP 50 10 6 - II.C.2',
    helpText: 'Holding rental properties for passive income is ineligible (active property management may qualify)',
  },
  {
    key: 'is_speculative_business',
    section: 'OPERATIONS',
    question: 'Does the business engage in speculative activities?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    sopReference: 'SOP 50 10 6 - II.C.2',
    helpText: 'Speculative real estate development, oil/gas exploration without proven reserves',
  },
  {
    key: 'is_pyramid_sales',
    section: 'OPERATIONS',
    question: 'Does the business use pyramid or multi-level marketing structures?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Prohibited Business Types'],
    sopReference: 'SOP 50 10 6 - II.C.2',
  },
  
  // ================================================================
  // SECTION: FEDERAL COMPLIANCE (CRITICAL)
  // ================================================================
  {
    key: 'has_delinquent_federal_debt',
    section: 'FEDERAL_COMPLIANCE',
    question: 'Does the business or any owner have delinquent federal debt?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Federal Debt Compliance'],
    sopReference: 'SOP 50 10 6 - II.A.6',
    helpText: 'CRITICAL: Delinquent federal debt (student loans, taxes, SBA loans, etc.) is an absolute disqualifier until resolved',
  },
  {
    key: 'has_delinquent_taxes',
    section: 'FEDERAL_COMPLIANCE',
    question: 'Does the business or any owner have delinquent taxes?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Tax Compliance'],
    sopReference: 'SOP 50 10 6 - II.A.6',
    helpText: 'Federal, state, or local tax delinquencies must be resolved or have payment plan',
  },
  {
    key: 'is_suspended_from_federal_contracting',
    section: 'FEDERAL_COMPLIANCE',
    question: 'Is the business or any owner suspended/debarred from federal contracting?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Federal Compliance'],
    sopReference: 'SOP 50 10 6 - II.A.6',
    helpText: 'Check SAM.gov exclusion database',
  },
  
  // ================================================================
  // SECTION: CHARACTER & BACKGROUND
  // ================================================================
  {
    key: 'has_felony_conviction_owners',
    section: 'CHARACTER',
    question: 'Has any owner (20%+) been convicted of a felony?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Character Standards'],
    sopReference: 'SOP 50 10 6 - II.A.7',
    helpText: 'Certain convictions may disqualify or require SBA review',
  },
  {
    key: 'is_presently_incarcerated',
    section: 'CHARACTER',
    question: 'Is any owner presently incarcerated or on parole/probation?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Character Standards'],
    sopReference: 'SOP 50 10 6 - II.A.7',
  },
  {
    key: 'has_defaulted_on_government_loan',
    section: 'CHARACTER',
    question: 'Has any owner previously defaulted on a government loan?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Character Standards'],
    sopReference: 'SOP 50 10 6 - II.A.7',
    helpText: 'SBA, USDA, or other federal loan defaults',
  },
  
  // ================================================================
  // SECTION: OWNERSHIP (for size standards & foreign ownership)
  // ================================================================
  {
    key: 'total_foreign_ownership_pct',
    section: 'OWNERSHIP',
    question: 'Total foreign ownership percentage',
    type: 'PERCENT',
    required: false,
    gatesAffected: ['Foreign Ownership Limit'],
    sopReference: 'SOP 50 10 6 - II.A.4',
    helpText: 'Foreign ownership over 49% may be ineligible',
    validation: {
      min: 0,
      max: 100,
    },
  },
  {
    key: 'owner_equity_injection_pct',
    section: 'OWNERSHIP',
    question: 'Owner equity injection (% of total project cost)',
    type: 'PERCENT',
    required: true,
    gatesAffected: ['Owner Equity Injection'],
    sopReference: 'SOP 50 10 6 - III.C',
    helpText: 'SBA typically requires 10-20% owner injection',
    validation: {
      min: 0,
      max: 100,
    },
  },
  
  // ================================================================
  // SECTION: AFFILIATES
  // ================================================================
  {
    key: 'has_affiliates',
    section: 'AFFILIATES',
    question: 'Does the business have affiliates (related businesses)?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Size Standards'],
    sopReference: 'SOP 50 10 6 - II.A.2',
    helpText: 'Affiliates include businesses with common ownership or control',
  },
  {
    key: 'has_sba_size_standard_compliant',
    section: 'AFFILIATES',
    question: 'Does the business (including affiliates) meet SBA size standards for its industry?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: ['Size Standards'],
    sopReference: 'SOP 50 10 6 - II.A.2',
    helpText: 'Size standards vary by NAICS code (revenue or employee limits)',
  },
  
  // ================================================================
  // SECTION: FINANCIALS
  // ================================================================
  {
    key: 'debt_service_coverage_ratio',
    section: 'FINANCIALS',
    question: 'Projected Debt Service Coverage Ratio (DSCR)',
    type: 'NUMBER',
    required: false,
    gatesAffected: ['DSCR'],
    helpText: 'Net Operating Income / Total Debt Service. Lenders typically require ≥ 1.25',
    validation: {
      min: 0,
      max: 10,
    },
  },
  {
    key: 'average_owner_credit_score',
    section: 'FINANCIALS',
    question: 'Average credit score of all owners (20%+)',
    type: 'NUMBER',
    required: false,
    gatesAffected: ['Credit Standards'],
    helpText: 'Most lenders require 680+ for SBA loans',
    validation: {
      min: 300,
      max: 850,
    },
  },
  
  // ================================================================
  // SECTION: CHANGE OF OWNERSHIP
  // ================================================================
  {
    key: 'is_change_of_ownership',
    section: 'BUSINESS_BASICS',
    question: 'Is this a change of ownership transaction?',
    type: 'BOOLEAN',
    required: true,
    gatesAffected: [],
    sopReference: 'SOP 50 10 6 - III.D',
    helpText: 'Buying an existing business',
  },
  {
    key: 'change_of_ownership_pct',
    section: 'BUSINESS_BASICS',
    question: 'Percentage of business being acquired',
    type: 'PERCENT',
    required: true,
    gatesAffected: [],
    conditionalOn: {
      questionKey: 'is_change_of_ownership',
      value: true,
    },
    validation: {
      min: 1,
      max: 100,
    },
  },
];

/**
 * Get questions for a specific section
 */
export function getQuestionsBySection(section: QuestionSection): SBAQuestion[] {
  return SBA_QUESTIONS.filter(q => q.section === section);
}

/**
 * Get all required questions
 */
export function getRequiredQuestions(): SBAQuestion[] {
  return SBA_QUESTIONS.filter(q => q.required);
}

/**
 * Get questions that affect a specific eligibility gate
 */
export function getQuestionsByGate(gate: string): SBAQuestion[] {
  return SBA_QUESTIONS.filter(q => q.gatesAffected.includes(gate));
}

/**
 * Check if a question should be shown based on conditional logic
 */
export function shouldShowQuestion(
  question: SBAQuestion,
  answers: Record<string, any>
): boolean {
  if (!question.conditionalOn) {
    return true;
  }
  
  const { questionKey, value } = question.conditionalOn;
  return answers[questionKey] === value;
}

/**
 * Get all currently applicable questions based on answers
 */
export function getApplicableQuestions(
  answers: Record<string, any>
): SBAQuestion[] {
  return SBA_QUESTIONS.filter(q => shouldShowQuestion(q, answers));
}
