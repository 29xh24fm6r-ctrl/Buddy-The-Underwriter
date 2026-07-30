import "server-only";

/**
 * SPEC-M7 ZERO-REPEAT-PREFILL-1 — the borrower-visible covenant counter
 * ("you answered N; we answered M"). Built entirely from data that
 * already exists — no new migration:
 *
 *   - "we answered" (total) = every BORROWER_FIELD_REGISTRY factPath
 *     already present in canonical state (answeredBorrowerFields.ts,
 *     SPEC-M5) — document uploads, Plaid, banker entry, structurer
 *     residue, and borrower-conversation answers all count.
 *   - "you answered" (borrower) = the subset of that total whose value is
 *     also present in this deal's own conversation facts bag
 *     (borrower_concierge_sessions.extracted_facts) — i.e. the borrower
 *     said it themselves, regardless of whether a document also happened
 *     to confirm it later.
 *   - "we answered" (system) = total minus borrower, floored at 0 — every
 *     answered field the borrower did NOT have to say out loud.
 *
 * This is a deliberately approximate, borrower-motivational stat, not a
 * financial value or compliance record — Invariant #1 doesn't apply
 * (nothing here is a canonical financial number), and a borrower
 * mentioning a fact a document also confirms still counts as "you
 * answered," which is the intuitive, generous reading.
 */

import {
  BORROWER_FIELD_REGISTRY,
  factKey,
  type BorrowerFieldEntry,
} from "@/lib/sba/forms/borrowerFieldRegistry";
import { loadAnsweredBorrowerFieldKeys } from "./answeredBorrowerFields";

export type SB = { from: (table: string) => any };

export type CovenantCounts = {
  borrowerAnswered: number;
  systemAnswered: number;
  totalAnswered: number;
};

function isPresent(v: unknown): boolean {
  return v != null && v !== "";
}

function valueForEntry(entry: BorrowerFieldEntry, facts: Record<string, any>): unknown {
  const key = factKey(entry);
  if (entry.entityScope === "business") return facts?.business?.[key];
  if (entry.entityScope === "loan") return facts?.loan?.[key];

  const owners = Array.isArray(facts?.owners) ? facts.owners : [];
  const firstOwner = owners[0] ?? {};
  if (entry.entityScope === "owner") return firstOwner[key];
  if (entry.entityScope === "pfs") return (firstOwner.pfs ?? {})[key];

  const entities = Array.isArray(facts?.entities) ? facts.entities : [];
  if (entry.entityScope === "entity") return (entities[0] ?? {})[key];

  return undefined;
}

export async function computeCovenantCounts(dealId: string, sb: SB): Promise<CovenantCounts> {
  const canonicallyAnswered = await loadAnsweredBorrowerFieldKeys(dealId, sb);
  const totalAnswered = canonicallyAnswered.size;

  const { data: conciergeRow } = await sb
    .from("borrower_concierge_sessions")
    .select("extracted_facts")
    .eq("deal_id", dealId)
    .maybeSingle();
  const extractedFacts = ((conciergeRow as { extracted_facts?: Record<string, any> } | null)?.extracted_facts ??
    {}) as Record<string, any>;

  let borrowerAnswered = 0;
  for (const entry of BORROWER_FIELD_REGISTRY) {
    if (!canonicallyAnswered.has(entry.factPath)) continue;
    if (isPresent(valueForEntry(entry, extractedFacts))) borrowerAnswered += 1;
  }

  return {
    borrowerAnswered,
    systemAnswered: Math.max(0, totalAnswered - borrowerAnswered),
    totalAnswered,
  };
}
