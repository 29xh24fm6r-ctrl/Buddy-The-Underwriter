/**
 * Rerun Document Flags — targeted re-evaluation after new document upload.
 *
 * Runs ONLY document + reconciliation flag modules (NOT full engine).
 * Auto-resolves flags whose trigger_type is no longer detected.
 * Inserts newly detected flags.
 *
 * Server-only. Never throws — callers treat as non-fatal.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { flagFromDocuments } from "./flagFromDocuments";
import { flagFromReconciliation } from "./flagFromReconciliation";
import { buildFlagEngineInput } from "./buildFlagEngineInput";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function rerunDocumentFlagsForDeal(
  dealId: string,
  bankId: string,
): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // 1. Build input from DB (shared helper)
    const input = await buildFlagEngineInput(dealId);

    // 2. Run ONLY document + reconciliation modules (NOT full engine)
    const docFlags = flagFromDocuments(input);
    const reconFlags = flagFromReconciliation(input);
    const newFlags = [...docFlags, ...reconFlags];

    // 3. Get new trigger_type set
    const newTriggerTypes = new Set(newFlags.map((f) => f.trigger_type));

    // 4. Query existing flags in relevant categories with active statuses
    const { data: existingRows, error: queryError } = await (sb as any)
      .from("deal_flags")
      .select("id, trigger_type, year_observed, status")
      .eq("deal_id", dealId)
      .in("category", ["missing_data", "financial_irregularity"])
      .in("status", ["open", "sent_to_borrower"]);

    if (queryError) {
      console.warn("[rerunDocumentFlags] existing flags query failed", {
        dealId,
        error: queryError.message,
      });
      return;
    }

    const existing = (existingRows ?? []) as Array<{
      id: string;
      trigger_type: string;
      year_observed: number | null;
      status: string;
    }>;

    const now = new Date().toISOString();
    let autoResolvedCount = 0;
    let newFlagCount = 0;

    // 5. Auto-resolve: existing flags whose trigger_type is NOT in new set
    for (const row of existing) {
      if (!newTriggerTypes.has(row.trigger_type)) {
        await (sb as any)
          .from("deal_flags")
          .update({
            status: "resolved",
            resolution_note: "Auto-resolved: condition no longer detected after document re-evaluation",
            updated_at: now,
          })
          .eq("id", row.id);

        await (sb as any).from("deal_flag_audit").insert({
          deal_id: dealId,
          flag_id: row.id,
          action: "resolved",
          actor: "system",
          previous_status: row.status,
          new_status: "resolved",
          note: "Auto-resolved: condition no longer detected after document upload",
        });

        autoResolvedCount++;
      }
    }

    // 6. New flags not in existing → insert with status "open"
    const existingTriggerTypes = new Set(existing.map((e) => e.trigger_type));
    for (const flag of newFlags) {
      if (!existingTriggerTypes.has(flag.trigger_type)) {
        const yearObserved = flag.year_observed ?? 0; // sentinel for NULL-year flags
        const observedValueStr = flag.observed_value != null ? String(flag.observed_value) : null;

        await (sb as any)
          .from("deal_flags")
          .upsert(
            {
              deal_id: dealId,
              category: flag.category,
              severity: flag.severity,
              trigger_type: flag.trigger_type,
              canonical_keys_involved: flag.canonical_keys_involved,
              observed_value: observedValueStr,
              expected_range_min: flag.expected_range?.min ?? null,
              expected_range_max: flag.expected_range?.max ?? null,
              expected_range_description: flag.expected_range?.description ?? null,
              year_observed: yearObserved,
              banker_summary: flag.banker_summary,
              banker_detail: flag.banker_detail,
              banker_implication: flag.banker_implication,
              has_borrower_question: flag.borrower_question !== null,
              status: "open",
              auto_generated: flag.auto_generated,
              updated_at: now,
            },
            { onConflict: "deal_id,trigger_type,year_observed" },
          );

        newFlagCount++;
      }
    }

    // 7. Emit ledger event
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "flags.document_reingestion",
      uiState: "done",
      uiMessage: `Document flag re-evaluation: ${autoResolvedCount} auto-resolved, ${newFlagCount} new flags`,
      meta: {
        autoResolved: autoResolvedCount,
        newFlags: newFlagCount,
        totalDocFlags: docFlags.length,
        totalReconFlags: reconFlags.length,
      },
    });
  } catch (err: any) {
    console.error("[rerunDocumentFlags] unexpected error", {
      dealId,
      bankId,
      error: err?.message,
    });
    // Never throws — callers treat as non-fatal
  }
}
