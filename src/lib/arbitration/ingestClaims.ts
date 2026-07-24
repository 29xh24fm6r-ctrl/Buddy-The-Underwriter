import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeAgentFindings } from "@/lib/agents/claim-normalization";
import { groupClaimsIntoConflicts } from "@/lib/agents/arbitration";

export type IngestClaimsResult = {
  claims_created: number;
  conflict_sets_created: number;
  conflict_sets?: ReturnType<typeof groupClaimsIntoConflicts>;
  message?: string;
};

export type ArbitrationSupabaseClient = { from: (table: string) => any };

/**
 * Normalizes agent findings into claims and creates conflict sets.
 *
 * Extracted from the POST /arbitration/ingest route body so
 * src/lib/autopilot/orchestrator.ts (S3_CLAIMS) can call it in-process
 * instead of an unauthenticated server-to-server fetch back into this same
 * app — that self-fetch had no way to carry the caller's Clerk session, so
 * getCurrentBankId() inside the target route would always throw
 * "not_authenticated" when invoked from the pipeline. The route below is
 * now a thin wrapper around this function; behavior is unchanged.
 *
 * `sb` is DI'd (defaults to supabaseAdmin()) so this can be unit-tested
 * with a fake client — this code path had zero test coverage before.
 */
export async function ingestClaimsForDeal(
  dealId: string,
  bankId: string,
  opts: { findingIds?: string[]; sb?: ArbitrationSupabaseClient } = {},
): Promise<IngestClaimsResult> {
  const sb = opts.sb ?? supabaseAdmin();

  let query = sb
    .from("agent_findings")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  if (opts.findingIds && opts.findingIds.length > 0) {
    query = query.in("id", opts.findingIds);
  }

  const { data: findings, error: findingsError } = await query;

  if (findingsError) {
    throw new Error(`Failed to fetch findings: ${findingsError.message}`);
  }

  if (!findings || findings.length === 0) {
    return {
      claims_created: 0,
      conflict_sets_created: 0,
      message: "No findings to ingest",
    };
  }

  const normalizedClaims = normalizeAgentFindings(findings);

  const { data: insertedClaims, error: claimsError } = await sb
    .from("agent_claims")
    .insert(normalizedClaims)
    .select();

  if (claimsError) {
    throw new Error(`Failed to insert claims: ${claimsError.message}`);
  }

  const conflictSets = groupClaimsIntoConflicts(normalizedClaims);

  const conflictSetRecords = conflictSets.map((set) => ({
    deal_id: dealId,
    bank_id: bankId,
    claim_hash: set.claim_hash,
    topic: set.topic,
    predicate: set.predicate,
    timeframe: set.timeframe,
    unit: set.unit,
    num_claims: set.claims.length,
    num_agents: set.num_agents,
    has_blocker: set.has_blocker,
    status: set.claims.length > 1 ? "open" : "resolved",
  }));

  const { data: insertedConflicts, error: conflictsError } = await sb
    .from("claim_conflict_sets")
    .upsert(conflictSetRecords, { onConflict: "deal_id,claim_hash" })
    .select();

  if (conflictsError) {
    throw new Error(`Failed to upsert conflict sets: ${conflictsError.message}`);
  }

  return {
    claims_created: insertedClaims?.length || 0,
    conflict_sets_created: insertedConflicts?.length || 0,
    conflict_sets: conflictSets,
  };
}
