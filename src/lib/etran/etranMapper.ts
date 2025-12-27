export function mapFactsToEtran(facts: any) {
  return {
    borrower_name: facts.business_name,
    ein: facts.ein,
    naics: facts.naics,
    loan_amount: facts.requested_amount,
    term_months: 120,
    use_of_proceeds: facts.use_of_proceeds
  };
}
