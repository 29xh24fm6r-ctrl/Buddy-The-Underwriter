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

/**
 * Columns for ONE table, deduped.
 *
 * Deduping alone was not enough. fieldsForScope("owner") carries two
 * entries — full_ssn and spouse_full_ssn — whose sourceTable is
 * deal_pii_records and whose column, `encrypted_payload`, does not exist on
 * ownership_entities. Selecting it made PostgREST reject the whole request,
 * and because only `data` was destructured the failure read as "this
 * borrower has answered nothing", so the concierge re-asked every owner and
 * PFS question they had already answered.
 *
 * Filtering by sourceTable is what makes the list correct; the dedupe stops
 * the same column being requested twice.
 */
function uniqueColumnsFor(table: string, entries: BorrowerFieldEntry[]): string[] {
  return [
    ...new Set(
      entries.filter((e) => e.sourceTable === table).map((e) => e.sourceColumn),
    ),
  ];
}

/** Entries actually backed by `table` — the ones a row from it can answer. */
function entriesFor(table: string, entries: BorrowerFieldEntry[]): BorrowerFieldEntry[] {
  return entries.filter((e) => e.sourceTable === table);
}

/**
 * Surface a failed read instead of letting it read as "nothing answered".
 * Every caller of this module treats an absent factPath as "ask the
 * borrower again", so a swallowed error costs the borrower a re-ask of
 * something they already told us.
 */
function readFailed(table: string, error: { message?: string } | null | undefined): boolean {
  if (!error) return false;
  console.warn(
    `[answeredBorrowerFields] read failed table=${table} (non-fatal, may cause a re-ask):`,
    error.message ?? String(error),
  );
  return true;
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
      const { data: borrowerRow, error: borrowerErr } = await sb
        .from("borrowers")
        .select(uniqueColumnsFor("borrowers", businessEntries).join(", "))
        .eq("id", deal.borrower_id)
        .maybeSingle();
      readFailed("borrowers", borrowerErr);
      collectPresent(
        entriesFor("borrowers", businessEntries),
        borrowerRow as Record<string, unknown> | null,
        answered,
      );
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
    const { data: loanRequest, error: loanErr } = await sb
      .from("deal_loan_requests")
      .select(uniqueColumnsFor("deal_loan_requests", loanEntries).join(", "))
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    readFailed("deal_loan_requests", loanErr);
    collectPresent(
      entriesFor("deal_loan_requests", loanEntries),
      loanRequest as Record<string, unknown> | null,
      answered,
    );

    const ownerEntries = fieldsForScope("owner");
    const { data: ownerRow, error: ownerErr } = await sb
      .from("ownership_entities")
      .select(["id", ...uniqueColumnsFor("ownership_entities", ownerEntries)].join(", "))
      .eq("deal_id", dealId)
      .eq("entity_type", "individual")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    readFailed("ownership_entities", ownerErr);
    collectPresent(
      entriesFor("ownership_entities", ownerEntries),
      ownerRow as Record<string, unknown> | null,
      answered,
    );

    const ownerId = (ownerRow as { id?: string } | null)?.id;
    if (ownerId) {
      const pfsEntries = fieldsForScope("pfs");
      const { data: pfsRow, error: pfsErr } = await sb
        .from("borrower_applicant_financials")
        .select(uniqueColumnsFor("borrower_applicant_financials", pfsEntries).join(", "))
        .eq("applicant_id", ownerId)
        .maybeSingle();
      readFailed("borrower_applicant_financials", pfsErr);
      collectPresent(
        entriesFor("borrower_applicant_financials", pfsEntries),
        pfsRow as Record<string, unknown> | null,
        answered,
      );
    }

    const entityEntries = fieldsForScope("entity");
    const { data: entityRow, error: entityErr } = await sb
      .from("ownership_entities")
      .select(uniqueColumnsFor("ownership_entities", entityEntries).join(", "))
      .eq("deal_id", dealId)
      .neq("entity_type", "individual")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    readFailed("ownership_entities", entityErr);
    collectPresent(
      entriesFor("ownership_entities", entityEntries),
      entityRow as Record<string, unknown> | null,
      answered,
    );
  } catch (e) {
    console.warn(
      "[answeredBorrowerFields] canonical read failed (non-fatal):",
      e instanceof Error ? e.message : String(e),
    );
  }

  return answered;
}
