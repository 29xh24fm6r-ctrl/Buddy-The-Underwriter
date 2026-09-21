import "server-only";

/** Only an explicit saved operating-stage answer can establish pre-opening.
 * A new borrower entity, franchise purchase, missing history or zero sales
 * alone never converts an acquisition/established business into a startup. */
export function packageBusinessStage(facts: any): "pre_opening" | "operating_or_unknown" {
  const answers = facts?.package_answers ?? {};
  if (answers.B07?.value !== "The business is preparing to open") return "operating_or_unknown";
  if (["Purchase of an operating franchise location", "Expansion of an existing franchise business"].includes(answers.K02?.value)) {
    throw new Error("financial_input_required: the franchise transaction and preparing-to-open answer conflict. Confirm whether this is a new location or an operating business.");
  }
  if (["acquisition", "expansion"].includes(answers.A11?.value) ||
      ["Buying an existing business", "Expanding an existing business"].includes(answers.A02?.value)) {
    throw new Error("financial_input_required: your project purpose and preparing-to-open answer conflict. Confirm the business stage before preparing the package.");
  }
  return "pre_opening";
}

export async function loadPackageBusinessStage(sb: any, dealId: string, bankId: string) {
  const deal = await sb.from("deals").select("bank_id").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
  if (deal.error || deal.data?.bank_id !== bankId) throw new Error("Financial snapshot deal/bank mismatch");
  const session = await sb.from("borrower_concierge_sessions").select("confirmed_facts").eq("deal_id", dealId).maybeSingle();
  if (session.error) throw new Error("package_business_stage_read_failed");
  return packageBusinessStage(session.data?.confirmed_facts);
}
