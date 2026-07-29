import "server-only";

/**
 * SPEC-M5 CONVERSATIONAL-INTAKE-1 — canonical "already answered" reader.
 *
 * Queries each BORROWER_FIELD_REGISTRY entry's own sourceTable/sourceColumn
 * directly, mirroring exactly the tables propagateBorrowerFacts.ts writes
 * to. This is deliberately NOT the same check as "is this fact present in
 * the concierge's own extracted_facts bag" — a field can be answered in
 * canonical state without ever having been part of this conversation's
 * local facts (a prior session before the cookie was lost, a document
 * upload, or a Plaid sync that propagated straight to canonical tables).
 * Skipping this check would let the interview re-ask a question the
 * borrower already effectively answered elsewhere — the exact repeat-ask
 * failure mode this spec exists to close (see beatMetrics.ts's
 * recordFactRequest doc comment and v_beat_repeat_ask_by_deal).
 *
 * amount_requested/use_of_proceeds are special-cased: the registry
 * declares their canonical home as deal_loan_requests, but
 * propagateBorrowerFacts.ts (see its §1/§2/§7 comments) actually routes
 * them to deals.loan_amount and borrower_applications.loan_purpose instead
 * — deal_loan_requests only ever receives the *other* loan-scope fields.
 * This reader follows the real write path, not the registry's nominal one.
 *
 * Scope: every registry entry EXCEPT the 2 backed by deal_pii_records
 * (full SSN — the concierge is explicitly forbidden from ever asking for a
 * full SSN, see borrowerConversation.ts's prompt) and the 2 backed by
 * sba_loans (loan number / closing date — post-approval/closing facts, not
 * something an intake conversation asks a prospective borrower). Those 4
 * fall back to conversation-facts-only truth, which is correct for fields
 * the interview never asks about anyway.
 *
 * Non-fatal: any read failure degrades to "nothing known from canonical
 * state," which only costs a possible re-ask, never a blocked turn.
 */

import {
  fieldsForScope,
  type BorrowerFieldEntry,
} from "@/lib/sba/forms/borrowerFieldRegistry";

export type SB = { from: (table: string) => any };

function uniqueColumns(entries: BorrowerFieldEntry[]): string[] {
  return [...new Set(entries.map((e) => e.sourceColumn))];
}

function collectPresent(
  entries: BorrowerFieldEntry[],
  row: Record<string, unknown> | null | undefined,
  out: Set<string>,
): void {
  if (!row) return;
  for (const entry of entries) {
    if (row[entry.sourceColumn] != null) out.add(entry.factPath);
  }
}

/**
 * Returns the set of registry `factPath`s already answered in canonical
 * state for this deal. Only the first individual owner and first
 * equity-owning entity are checked — same "first owner only" convention as
 * computeNextCriticalField/computeNextRequiredFields, so the ranker and
 * this reader agree on which owner a question is about.
 */
export async function loadAnsweredBorrowerFieldKeys(dealId: string, sb: SB): Promise<Set<string>> {
  const answered = new Set<string>();

  try {
    const { data: deal } = await sb
      .from("deals")
      .select("borrower_id, loan_amount")
      .eq("id", dealId)
      .maybeSingle();

    if (deal?.loan_amount != null) answered.add("loan.amount_requested");

    const businessEntries = fieldsForScope("business");
    if (deal?.borrower_id) {
      const { data: borrowerRow } = await sb
        .from("borrowers")
        .select(uniqueColumns(businessEntries).join(", "))
        .eq("id", deal.borrower_id)
        .maybeSingle();
      collectPresent(businessEntries, borrowerRow as Record<string, unknown> | null, answered);
    }

    const { data: application } = await sb
      .from("borrower_applications")
      .select("loan_purpose")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (application?.loan_purpose != null) answered.add("loan.use_of_proceeds");

    const loanEntries = fieldsForScope("loan").filter(
      (e) => e.sourceColumn !== "requested_amount" && e.sourceColumn !== "use_of_proceeds",
    );
    const { data: loanRequest } = await sb
      .from("deal_loan_requests")
      .select(uniqueColumns(loanEntries).join(", "))
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    collectPresent(loanEntries, loanRequest as Record<string, unknown> | null, answered);

    const ownerEntries = fieldsForScope("owner");
    const { data: ownerRow } = await sb
      .from("ownership_entities")
      .select(["id", ...uniqueColumns(ownerEntries)].join(", "))
      .eq("deal_id", dealId)
      .eq("entity_type", "individual")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    collectPresent(ownerEntries, ownerRow as Record<string, unknown> | null, answered);

    const ownerId = (ownerRow as { id?: string } | null)?.id;
    if (ownerId) {
      const pfsEntries = fieldsForScope("pfs");
      const { data: pfsRow } = await sb
        .from("borrower_applicant_financials")
        .select(uniqueColumns(pfsEntries).join(", "))
        .eq("applicant_id", ownerId)
        .maybeSingle();
      collectPresent(pfsEntries, pfsRow as Record<string, unknown> | null, answered);
    }

    const entityEntries = fieldsForScope("entity");
    const { data: entityRow } = await sb
      .from("ownership_entities")
      .select(uniqueColumns(entityEntries).join(", "))
      .eq("deal_id", dealId)
      .neq("entity_type", "individual")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    collectPresent(entityEntries, entityRow as Record<string, unknown> | null, answered);
  } catch (e) {
    console.warn(
      "[answeredBorrowerFields] canonical read failed (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
  }

  return answered;
}
