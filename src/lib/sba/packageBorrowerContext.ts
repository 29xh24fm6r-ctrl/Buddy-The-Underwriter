import "server-only";

type Row = Record<string, any>;
const text = (...values: unknown[]): string | null => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
};

/** Saved business facts precede legacy application/display fields. A missing
 * directory link is not a negative franchise answer or evidence of eligibility. */
export function resolvePackageBorrowerContext(deal: Row, borrower: Row | null, app: Row | null, facts: Row | null) {
  const answers = facts?.package_answers ?? {};
  const franchiseDescription = text(answers.K01?.value);
  const franchiseTransaction = text(answers.K02?.value);
  const franchiseDeclared = ["New franchise location", "Purchase of an operating franchise location", "Expansion of an existing franchise business"].includes(franchiseTransaction ?? "");
  return {
    name: text(borrower?.legal_name, app?.business_legal_name, deal.name) ?? "Borrower",
    city: text(borrower?.project_address_city, borrower?.city, deal.city),
    state: text(borrower?.project_address_state, borrower?.state, deal.state),
    naics: text(borrower?.naics_code, app?.naics),
    industry: text(borrower?.naics_description, app?.industry, answers.B06?.value),
    franchiseDeclared,
    franchiseDescription,
    franchiseTransaction,
    proposedLocation: text(answers.B04?.value),
    siteContext: text(answers.J07?.value),
  };
}

export async function loadPackageBorrowerContext(sb: { from: (table: string) => any }, dealId: string, bankId: string) {
  const deal = await sb.from("deals").select("id,bank_id,borrower_id,name,city,state").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
  if (deal.error || !deal.data || deal.data.bank_id !== bankId) throw new Error("package_borrower_context_deal_mismatch");
  const [borrower, app, session] = await Promise.all([
    deal.data.borrower_id ? sb.from("borrowers").select("legal_name,city,state,project_address_city,project_address_state,naics_code,naics_description").eq("id", deal.data.borrower_id).maybeSingle() : { data: null },
    sb.from("borrower_applications").select("business_legal_name,naics,industry").eq("deal_id", dealId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("borrower_concierge_sessions").select("confirmed_facts").eq("deal_id", dealId).maybeSingle(),
  ]);
  if (borrower.error || app.error || session.error) throw new Error("package_borrower_context_read_failed");
  return resolvePackageBorrowerContext(deal.data, borrower.data, app.data, session.data?.confirmed_facts);
}
