import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildDealNameProjection,
  DEAL_NAME_SELECT,
  DEAL_NAME_SELECT_MINIMAL,
  type DealNameProjection,
} from "./dealNameProjection";

export type { DealNameProjection };
export {
  buildDealNameProjection,
  DEAL_NAME_SELECT,
  DEAL_NAME_SELECT_MINIMAL,
};

/**
 * SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1
 *
 * The single server-side reader for a deal's canonical name. Schema-safe:
 *  - Selects ONLY proven-live `deals` columns (never `legal_name`).
 *  - On a column error, retries with the minimal proven set so a missing
 *    optional column can never collapse the label to the fallback.
 *  - Never throws; returns null only when the deal genuinely cannot be read.
 *
 * Caller must pass an already-authorized bankId (e.g. from ensureDealBankAccess).
 */
export async function loadDealNameProjection(
  dealId: string,
  bankId: string,
): Promise<DealNameProjection | null> {
  const sb = supabaseAdmin();

  let row: Record<string, unknown> | null = null;

  const primary = await sb
    .from("deals")
    .select(DEAL_NAME_SELECT)
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (primary.error) {
    // An optional naming column may be absent in this environment. Retry with
    // the minimal proven set rather than letting the whole read fail.
    console.warn(
      `[loadDealNameProjection] primary select failed (${primary.error.message}); retrying minimal`,
    );
    const minimal = await sb
      .from("deals")
      .select(DEAL_NAME_SELECT_MINIMAL)
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle();
    if (minimal.error) {
      console.error(
        `[loadDealNameProjection] minimal select failed: ${minimal.error.message}`,
      );
      return null;
    }
    row = (minimal.data as Record<string, unknown> | null) ?? null;
  } else {
    row = (primary.data as Record<string, unknown> | null) ?? null;
  }

  if (!row) return null;

  // Borrower-name fallback from intake when the deal column is blank — matches
  // the historical deal-shell behavior so the consolidation is non-regressive.
  let intakeBorrowerName: string | null = null;
  if (!row.borrower_name) {
    const { data: intake } = await sb
      .from("deal_intake")
      .select("borrower_name")
      .eq("deal_id", dealId)
      .maybeSingle();
    intakeBorrowerName =
      (intake?.borrower_name as string | null | undefined) ?? null;
  }

  return buildDealNameProjection(dealId, row, { intakeBorrowerName });
}
