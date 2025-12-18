export type SbaIntakeV1 = {
  business: {
    legal_name: string | null;
    ein: string | null;
    industry: string | null;
    naics: string | null;
  };

  loan: {
    amount: number | null;
    use_of_proceeds_primary:
      | "working_capital"
      | "acquisition"
      | "equipment"
      | "real_estate"
      | "refi"
      | "other"
      | null;
  };

  sba_gate: {
    want_sba: boolean | null;
    ineligible_business: boolean | null;
    federal_debt_delinquent: boolean | null;
    owners_us_eligible: boolean | null;
    criminal_history: boolean | null;
    proceeds_prohibited: boolean | null;
    exceeds_size_standard: boolean | null;
  };

  sba_track: {
    has_20pct_owners_listed: boolean | null;
    has_affiliates: boolean | null;
    management_experience_summary: string | null;
  };
};
