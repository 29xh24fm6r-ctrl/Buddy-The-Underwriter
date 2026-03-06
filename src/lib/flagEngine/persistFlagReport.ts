/**
 * Persist Flag Report — generate flags via pure engine, persist to Supabase.
 *
 * Server-only. Never throws — callers treat as non-fatal.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { composeFlagReport } from "./flagComposer";
import { buildFlagEngineInput } from "./buildFlagEngineInput";
import type { SpreadFlag, BorrowerQuestion } from "./types";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function generateAndPersistFlags(
  dealId: string,
  bankId: string,
): Promise<{ ok: boolean; flagCount: number }> {
  try {
    const sb = supabaseAdmin();

    // 1. Build input from DB
    const input = await buildFlagEngineInput(dealId);

    // 2. Run pure flag engine
    const output = composeFlagReport(input);

    if (output.flags.length === 0) {
      // No flags — still log, but nothing to persist
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "flags.generated",
        uiState: "done",
        uiMessage: "Flag engine ran — no flags detected",
        meta: { flagCount: 0, critical: 0, elevated: 0, has_blocking: false },
      });
      return { ok: true, flagCount: 0 };
    }

    // 3. Upsert flags into deal_flags
    for (const flag of output.flags) {
      const yearObserved = flag.year_observed ?? 0; // sentinel for NULL-year flags
      const observedValueStr = flag.observed_value != null ? String(flag.observed_value) : null;

      const { error: flagError } = await (sb as any)
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
            updated_at: new Date().toISOString(),
          },
          { onConflict: "deal_id,trigger_type,year_observed" },
        );

      if (flagError) {
        console.warn("[persistFlagReport] flag upsert failed", {
          dealId,
          triggerType: flag.trigger_type,
          error: flagError.message,
        });
        continue;
      }

      // 4. Upsert borrower question if present
      if (flag.borrower_question) {
        await upsertBorrowerQuestion(sb, dealId, flag, flag.borrower_question);
      }
    }

    // 5. Write audit entry
    await (sb as any).from("deal_flag_audit").insert({
      deal_id: dealId,
      flag_id: "00000000-0000-0000-0000-000000000000", // system-level, not per-flag
      action: "generated",
      actor: "system",
      note: `Auto-generated after spread computation — ${output.flags.length} flags (${output.critical_count} critical, ${output.elevated_count} elevated)`,
    });

    // 6. Ledger event
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "flags.generated",
      uiState: "done",
      uiMessage: `${output.flags.length} risk flags generated (${output.critical_count} critical)`,
      meta: {
        flagCount: output.flags.length,
        critical: output.critical_count,
        elevated: output.elevated_count,
        watch: output.watch_count,
        informational: output.informational_count,
        has_blocking: output.has_blocking_flags,
      },
    });

    return { ok: true, flagCount: output.flags.length };
  } catch (err: any) {
    console.error("[persistFlagReport] unexpected error", {
      dealId,
      bankId,
      error: err?.message,
    });
    return { ok: false, flagCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertBorrowerQuestion(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  flag: SpreadFlag,
  question: BorrowerQuestion,
): Promise<void> {
  try {
    // First, get the DB flag id for this trigger_type + year
    const yearObserved = flag.year_observed ?? 0;
    const { data: dbFlag } = await (sb as any)
      .from("deal_flags")
      .select("id")
      .eq("deal_id", dealId)
      .eq("trigger_type", flag.trigger_type)
      .eq("year_observed", yearObserved)
      .maybeSingle();

    if (!dbFlag?.id) return;

    await (sb as any)
      .from("deal_borrower_questions")
      .upsert(
        {
          deal_id: dealId,
          flag_id: dbFlag.id,
          question_text: question.question_text,
          question_context: question.question_context,
          document_requested: question.document_requested ?? null,
          document_format: question.document_format ?? null,
          document_urgency: question.document_urgency,
          recipient_type: question.recipient_type,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "flag_id" },
      );
  } catch (err: any) {
    console.warn("[persistFlagReport] question upsert failed", {
      dealId,
      flagId: flag.flag_id,
      error: err?.message,
    });
  }
}
