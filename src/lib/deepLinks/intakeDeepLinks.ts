export type IntakeDeepLink = {
  tab?: string;
  hash?: string;
  href: string;
};

const build = (dealId: string, hash?: string, tab?: string): IntakeDeepLink => {
  const base = `/deals/${dealId}/cockpit`;
  const tabParam = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  return {
    tab,
    hash,
    href: `${base}${tabParam}${hash ? `#${hash}` : ""}`,
  };
};

export function intakeDeepLinkForMissing(missingKey: string | null, dealId: string): IntakeDeepLink {
  switch (missingKey) {
    case "deal_name":
      return build(dealId, "deal-name", "overview");
    case "borrower":
      return build(dealId, "borrower-identity", "intake");
    case "intake_lifecycle":
      return build(dealId, "intake", "intake");
    case "loan_amount":
    case "loan_terms":
    case "term_months":
      return { href: `/deals/${dealId}/loan-terms#loan-request`, hash: "loan-request", tab: "terms" };
    case "credit_snapshot":
      return { href: `/deals/${dealId}/pricing`, tab: "pricing" };
    case "pricing_quote":
      return { href: `/deals/${dealId}/pricing`, tab: "pricing" };
    case "required_checklist":
      return { href: `/deals/${dealId}/documents`, tab: "documents" };
    default:
      return build(dealId, "intake", "intake");
  }
}
