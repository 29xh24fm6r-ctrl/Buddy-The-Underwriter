import "server-only";

/**
 * reconcileDealOwners — make `ownership_entities` match the cap table the
 * borrower just submitted, exactly.
 *
 * WHY THIS EXISTS.
 *
 * Every owner writer in this codebase was additive. `save_ownership` wrote
 * the borrower's list into `extracted_facts` and let propagateBorrowerFacts
 * insert-if-missing from there; propagation is fill-if-null by design, so
 * it can create an owner and it can fill a blank column, but it can never
 * correct a wrong value and it can never remove a row. The borrower-facing
 * consequence was that a typo was permanent: deal b296dec2 carries a
 * duplicate "matt paller" at 49% that no borrower action could delete,
 * taking its cap table to 149%.
 *
 * This function closes both gaps. The submitted list is authoritative:
 *
 *   - an owner carrying an `id` renames / re-weights that row (an EDIT, so
 *     it overrides the fill-if-null precedence — an explicit borrower
 *     correction IS the real answer)
 *   - an owner without an `id` matches an existing row by name
 *     (ownerNameMatch, so "matt paller" lands on "Matthew Paller" instead
 *     of becoming a third owner) or is inserted
 *   - a row the deal already holds that the submission does not mention is
 *     REMOVED
 *
 * REMOVAL IS GUARDED. `ownership_entities` has no soft-delete column, and
 * several tables reference it with ON DELETE NO ACTION — a signed SBA
 * form, a signing request, a package run item, stored PII, a SAM
 * exclusion, an IRS transcript request. Deleting an owner those point at
 * would either fail with a raw FK error or destroy evidence. Any such row
 * makes the owner non-removable, and the caller is told which, so the
 * borrower gets "ask your advisor" instead of a silent failure.
 *
 * Cascading children (identity verifications, credit pulls, character
 * question confirmations, PFS lines) go with the owner by design: they
 * describe a person who is no longer on the cap table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { findOwnerNameMatch } from "@/lib/ownership/ownerNameMatch";

export type SubmittedOwner = {
  id?: string | null;
  full_name: string;
  ownership_pct: number;
};

export type ReconcileResult = {
  /** Owner rows that survived, in submission order. */
  owners: Array<{ id: string; display_name: string; ownership_pct: number }>;
  inserted: string[];
  updated: string[];
  removed: string[];
  /** Owners the borrower dropped that could not be removed, with why. */
  retained: Array<{ id: string; display_name: string; reason: string }>;
  errors: string[];
};

/**
 * Tables that reference ownership_entities with ON DELETE NO ACTION, in
 * the order we want to report them — most meaningful reliance first. The
 * message is what the borrower reads, so it names the consequence rather
 * than the table.
 */
const BLOCKING_REFERENCES: Array<{
  table: string;
  column: string;
  reason: string;
}> = [
  {
    table: "signed_documents",
    column: "signer_ownership_entity_id",
    reason: "they have already signed a document on this application",
  },
  {
    table: "signing_requests",
    column: "signer_ownership_entity_id",
    reason: "a signature has already been requested from them",
  },
  {
    table: "sba_package_run_items",
    column: "ownership_entity_id",
    reason: "they are already part of a generated SBA package",
  },
  {
    table: "deal_pii_records",
    column: "ownership_entity_id",
    reason: "their verified personal information is already on file",
  },
  {
    table: "borrower_sam_exclusions",
    column: "ownership_entity_id",
    reason: "a federal exclusions check has already run for them",
  },
  {
    table: "borrower_irs_transcript_requests",
    column: "ownership_entity_id",
    reason: "an IRS transcript has already been requested for them",
  },
];

/**
 * Why this owner cannot be deleted, or null if they can be.
 *
 * A failed count read returns a blocker rather than null: if we cannot
 * prove nothing depends on the owner, we do not delete them. Losing a
 * signed form is unrecoverable; leaving a stale owner one more minute is
 * not.
 */
export async function ownerRemovalBlocker(
  sb: SupabaseClient,
  ownerId: string,
): Promise<string | null> {
  for (const ref of BLOCKING_REFERENCES) {
    const { count, error } = await sb
      .from(ref.table)
      .select("id", { count: "exact", head: true })
      .eq(ref.column, ownerId);
    if (error) {
      return `we couldn't confirm it's safe to remove them (${ref.table})`;
    }
    if ((count ?? 0) > 0) return ref.reason;
  }
  return null;
}

export async function reconcileDealOwners(args: {
  sb: SupabaseClient;
  dealId: string;
  owners: SubmittedOwner[];
}): Promise<ReconcileResult> {
  const { sb, dealId, owners } = args;
  const result: ReconcileResult = {
    owners: [],
    inserted: [],
    updated: [],
    removed: [],
    retained: [],
    errors: [],
  };

  const { data: existingRaw, error: loadError } = await sb
    .from("ownership_entities")
    .select("id, display_name, ownership_pct, entity_type")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (loadError) {
    result.errors.push(`load: ${loadError.message}`);
    return result;
  }

  type ExistingOwner = {
    id: string;
    display_name: string | null;
    ownership_pct: number | string | null;
    entity_type: string | null;
  };

  // Only individual owners are reconciled here. Equity-owning ENTITIES are
  // written into the same table by propagateBorrowerFacts section 6 and are
  // not part of the borrower's individual-owner form — sweeping them into
  // the "not mentioned, therefore remove" branch would delete a legitimate
  // holding company the borrower was never shown.
  const existing = ((existingRaw ?? []) as unknown as ExistingOwner[]).filter(
    (row) => (row.entity_type ?? "individual") === "individual",
  );

  const claimed = new Set<string>();
  const remainingForMatch = [...existing];

  for (const submitted of owners) {
    const fullName = submitted.full_name.trim();
    if (!fullName) continue;

    let target: ExistingOwner | null = null;
    if (submitted.id) {
      target = existing.find((row) => row.id === submitted.id) ?? null;
      // An id we don't recognize is not a reason to fail the whole save —
      // it means the row was removed in another tab. Fall through to name
      // matching, then to insert.
    }
    if (!target) {
      target =
        findOwnerNameMatch(
          fullName,
          remainingForMatch.filter((row) => !claimed.has(row.id)),
        )?.row ?? null;
    }

    if (target) {
      claimed.add(target.id);
      const currentPct =
        target.ownership_pct == null ? null : Number(target.ownership_pct);
      const needsUpdate =
        target.display_name !== fullName ||
        currentPct == null ||
        Math.abs(currentPct - submitted.ownership_pct) > 0.001;

      if (needsUpdate) {
        const { error } = await sb
          .from("ownership_entities")
          .update({
            display_name: fullName,
            ownership_pct: submitted.ownership_pct,
          })
          .eq("id", target.id)
          .eq("deal_id", dealId);
        if (error) {
          result.errors.push(`update(${fullName}): ${error.message}`);
          continue;
        }
        result.updated.push(fullName);
      }
      result.owners.push({
        id: target.id,
        display_name: fullName,
        ownership_pct: submitted.ownership_pct,
      });
      continue;
    }

    const { data: inserted, error } = await sb
      .from("ownership_entities")
      .insert({
        deal_id: dealId,
        entity_type: "individual",
        display_name: fullName,
        ownership_pct: submitted.ownership_pct,
        confidence: 0.9,
        meta_json: { source: "borrower_ownership_step" },
      })
      .select("id")
      .maybeSingle();

    if (error || !inserted?.id) {
      result.errors.push(`insert(${fullName}): ${error?.message ?? "no row returned"}`);
      continue;
    }
    claimed.add(String(inserted.id));
    remainingForMatch.push({
      id: String(inserted.id),
      display_name: fullName,
      ownership_pct: submitted.ownership_pct,
      entity_type: "individual",
    });
    result.inserted.push(fullName);
    result.owners.push({
      id: String(inserted.id),
      display_name: fullName,
      ownership_pct: submitted.ownership_pct,
    });
  }

  for (const row of existing) {
    if (claimed.has(row.id)) continue;
    const displayName = row.display_name ?? "An owner";
    const blocker = await ownerRemovalBlocker(sb, row.id);
    if (blocker) {
      result.retained.push({ id: row.id, display_name: displayName, reason: blocker });
      result.owners.push({
        id: row.id,
        display_name: displayName,
        ownership_pct: row.ownership_pct == null ? 0 : Number(row.ownership_pct),
      });
      continue;
    }
    const { error } = await sb
      .from("ownership_entities")
      .delete()
      .eq("id", row.id)
      .eq("deal_id", dealId);
    if (error) {
      result.errors.push(`delete(${displayName}): ${error.message}`);
      result.owners.push({
        id: row.id,
        display_name: displayName,
        ownership_pct: row.ownership_pct == null ? 0 : Number(row.ownership_pct),
      });
      continue;
    }
    result.removed.push(displayName);
  }

  return result;
}
