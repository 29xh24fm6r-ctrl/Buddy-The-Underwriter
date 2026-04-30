import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  checkSpreadPreflight,
  type SpreadPreflightInput,
  type SpreadPreflightResult,
} from "./spreadPreflightPure";

export type {
  SpreadPreflightInput,
  SpreadPreflightResult,
  SpreadPreflightOk,
  SpreadPreflightBlocked,
} from "./spreadPreflightPure";

export { checkSpreadPreflight } from "./spreadPreflightPure";

/**
 * Run preflight against a loaded ClassicSpreadInput. Performs a small DB
 * lookup to enumerate distinct source documents so the blocker payload can
 * tell the banker which docs were processed but didn't yield required facts.
 *
 * Never throws. Returns a structured result that the route can JSON-serialize
 * directly.
 */
export async function preflightClassicSpread(args: {
  dealId: string;
  bankId: string;
  balanceSheetRowCount: number;
  incomeStatementRowCount: number;
}): Promise<SpreadPreflightResult> {
  const sourceDocuments = await loadDistinctSourceDocuments(args.dealId, args.bankId);

  const input: SpreadPreflightInput = {
    balanceSheetRowCount: args.balanceSheetRowCount,
    incomeStatementRowCount: args.incomeStatementRowCount,
    sourceDocuments,
  };

  const result = checkSpreadPreflight(input);

  if (result.status === "blocked") {
    void emitBlockedEvent({
      dealId: args.dealId,
      missingFacts: result.missingFacts,
      sourceDocuments: result.sourceDocuments,
    });
  }

  return result;
}

async function loadDistinctSourceDocuments(
  dealId: string,
  bankId: string,
): Promise<string[]> {
  try {
    const sb = supabaseAdmin();
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("source_document_id")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .not("source_document_id", "is", null);

    if (error) return [];
    const set = new Set<string>();
    for (const row of (data ?? []) as Array<{ source_document_id: string | null }>) {
      const id = row.source_document_id;
      if (id) set.add(id);
    }
    // SENTINEL_UUID is the all-zeros placeholder used when a fact has no
    // backing document (computed metrics, debt-service derivations, etc.).
    // Strip it from the user-facing list.
    set.delete("00000000-0000-0000-0000-000000000000");
    return Array.from(set);
  } catch {
    return [];
  }
}

async function emitBlockedEvent(args: {
  dealId: string;
  missingFacts: string[];
  sourceDocuments: string[];
}): Promise<void> {
  try {
    const { writeEvent } = await import("@/lib/ledger/writeEvent");
    await writeEvent({
      dealId: args.dealId,
      kind: "spread.preflight.blocked",
      scope: "spreads",
      action: "blocked",
      requiresHumanReview: true,
      meta: {
        reason: "missing_financial_facts",
        missing_facts: args.missingFacts,
        source_documents: args.sourceDocuments,
      },
    });
  } catch {
    // Non-fatal — preflight result still returned to caller.
  }
}
