// Best-effort cache writer for the Memo Inputs UI panel.
//
// This is NOT the authoritative gate — evaluateMemoInputReadiness() is the
// gate. This cache exists so the Memo Inputs page can render the panel
// without re-running the evaluator on every render.

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MemoInputReadiness } from "./types";

export async function writeMemoInputReadinessRow(args: {
  dealId: string;
  bankId: string;
  readiness: MemoInputReadiness;
}): Promise<void> {
  try {
    const sb = supabaseAdmin();
    await (sb as any)
      .from("deal_memo_input_readiness")
      .upsert(
        {
          deal_id: args.dealId,
          bank_id: args.bankId,
          borrower_story_complete: args.readiness.borrower_story_complete,
          management_complete: args.readiness.management_complete,
          collateral_complete: args.readiness.collateral_complete,
          financials_complete: args.readiness.financials_complete,
          research_complete: args.readiness.research_complete,
          conflicts_resolved: args.readiness.conflicts_resolved,
          readiness_score: args.readiness.readiness_score,
          blockers: args.readiness.blockers,
          warnings: args.readiness.warnings,
          evaluated_at: args.readiness.evaluatedAt,
        },
        { onConflict: "deal_id" },
      );
  } catch {
    // Cache is non-load-bearing.
  }
}
