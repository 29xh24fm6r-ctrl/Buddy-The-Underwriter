export type WizardTrack = "SBA_7A" | "CONVENTIONAL" | "UNKNOWN";

export type WizardSection = {
  id: string;
  title: string;
  track: WizardTrack | "ALL";
  questions: WizardQuestion[];
};

export type WizardQuestion = {
  key: string;          // stable key stored in borrower_answers.question_key
  section: string;      // borrower_answers.section
  label: string;
  type: "text" | "number" | "yesno" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
};

export const SECTIONS: WizardSection[] = [
  {
    id: "business",
    title: "Business Info",
    track: "ALL",
    questions: [
      { key: "business.legal_name", section: "business", label: "Legal business name", type: "text", required: true },
      { key: "business.ein", section: "business", label: "EIN", type: "text" },
      { key: "business.industry", section: "business", label: "Industry", type: "text" },
      { key: "business.naics", section: "business", label: "NAICS (optional)", type: "text" },
    ],
  },
  {
    id: "loan",
    title: "Loan Request",
    track: "ALL",
    questions: [
      { key: "loan.amount", section: "loan", label: "Loan amount requested", type: "number", required: true },
      {
        key: "loan.use_of_proceeds.primary",
        section: "loan",
        label: "Primary use of proceeds",
        type: "select",
        required: true,
        options: [
          { value: "working_capital", label: "Working capital" },
          { value: "acquisition", label: "Business acquisition" },
          { value: "equipment", label: "Equipment purchase" },
          { value: "real_estate", label: "Commercial real estate" },
          { value: "refi", label: "Refinance" },
          { value: "other", label: "Other" },
        ],
      },
    ],
  },
  {
    id: "sba_gate",
    title: "SBA Eligibility Check",
    track: "ALL",
    questions: [
      { key: "sba.intent.want_sba", section: "sba", label: "Do you want us to evaluate SBA (7(a)) eligibility?", type: "yesno", required: true },
      { key: "sba.flags.ineligible_business", section: "sba", label: "Is the business in an ineligible SBA industry category?", type: "yesno", required: true },
      { key: "sba.flags.federal_debt_delinquent", section: "sba", label: "Any owners delinquent on federal debt?", type: "yesno", required: true },
      { key: "sba.flags.owners_us_eligible", section: "sba", label: "Are all required owners/guarantors U.S. eligible?", type: "yesno", required: true },
      { key: "sba.flags.criminal_history", section: "sba", label: "Any owners with criminal history that could affect eligibility?", type: "yesno", required: true },
      { key: "sba.flags.proceeds_prohibited", section: "sba", label: "Any proceeds intended for prohibited uses?", type: "yesno", required: true },
      { key: "sba.flags.exceeds_size_standard", section: "sba", label: "Is the business likely above SBA size standards?", type: "yesno", required: true },
    ],
  },
  {
    id: "sba_track",
    title: "SBA 7(a) Details",
    track: "SBA_7A",
    questions: [
      { key: "sba.ownership.has_20pct_owners_listed", section: "sba", label: "Have you listed all owners with 20%+ ownership?", type: "yesno", required: true },
      { key: "sba.affiliates.has_affiliates", section: "sba", label: "Does any owner have other businesses (affiliates)?", type: "yesno", required: true },
      { key: "sba.management.experience_summary", section: "sba", label: "Briefly describe management experience relevant to the business", type: "text", required: true },
    ],
  },
  {
    id: "conv_track",
    title: "Conventional Details",
    track: "CONVENTIONAL",
    questions: [
      { key: "conv.collateral.available", section: "conv", label: "Do you have collateral available to support the loan?", type: "yesno" },
      { key: "conv.time_in_business_years", section: "conv", label: "Years in business", type: "number" },
    ],
  },
];
