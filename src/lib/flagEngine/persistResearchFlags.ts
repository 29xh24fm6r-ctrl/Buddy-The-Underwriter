/**
 * Persist research-derived flags to deal_flags.
 *
 * Uses the same upsert pattern as persistFlagReport.ts but with
 * source="research_engine" to allow re-run without duplicates.
 *
 * The unique constraint on deal_flags is (deal_id, trigger_type, year_observed).
 * Research flags use year_observed = 0 (sentinel for structural/non-year flags).
 *
 * Server-only. Never throws — callers treat as non-fatal.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SpreadFlag } from "./types";

export async function persistResearchFlags(
  dealId: string,
  flags: SpreadFlag[],
): Promise<void> {
  if (flags.length === 0) return;

  const sb = supabaseAdmin();

  const rows = flags.map((f) => ({
    deal_id: dealId,
    trigger_type: f.trigger_type,
    category: f.category,
    severity: f.severity,
    canonical_keys_involved: f.canonical_keys_involved ?? [],
    observed_value: f.observed_value != null ? String(f.observed_value) : null,
    year_observed: 0, // sentinel — research flags are not year-specific
    banker_summary: f.banker_summary,
    banker_detail: f.banker_detail,
    banker_implication: f.banker_implication,
    has_borrower_question: false,
    status: "open",
    auto_generated: true,
    metadata: f.metadata ?? {},
    updated_at: new Date().toISOString(),
  }));

  const { error } = await (sb as any)
    .from("deal_flags")
    .upsert(rows, {
      onConflict: "deal_id,trigger_type,year_observed",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error("[persistResearchFlags] upsert failed", error.message);
    throw new Error(`persistResearchFlags failed: ${error.message}`);
  }
}
