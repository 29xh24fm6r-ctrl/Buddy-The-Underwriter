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
      // No flags from the engine — but stale auto-generated flags may still be
      // open from a prior run whose source facts were since superseded. Resolve
      // them BEFORE returning. An empty engine output must never leave a flag
      // behind: fact invalidation and flag cleanup are one workflow.
      await resolveStaleAutoFlags(sb, dealId, new Set<string>());
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

      // 4. Upsert borrower question if present; delete stale question if suppressed
      if (flag.borrower_question) {
        await upsertBorrowerQuestion(sb, dealId, flag, flag.borrower_question);
      } else {
        // Evidence gate suppressed the question — remove any stale persisted question
        await deleteStaleBorrowerQuestion(sb, dealId, flag);
      }
    }

    // 4b. Resolve stale auto-generated flags no longer supported by current facts.
    // When source facts are superseded/removed, the engine stops producing the
    // corresponding flag, but the old deal_flags row persists. Resolve it.
    const newFlagKeys = new Set(
      output.flags.map((f) => `${f.trigger_type}:${f.year_observed ?? 0}`),
    );
    await resolveStaleAutoFlags(sb, dealId, newFlagKeys);

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
// Stale-flag cleanup — invalid facts must never leave active flags behind
// ---------------------------------------------------------------------------

/**
 * Resolve auto-generated flags that the current engine output no longer supports.
 *
 * Runs on every persist pass (including empty output) so that superseding the
 * source facts always clears the dependent flag in the same workflow.
 *
 * `liveFlagKeys` is the set of `${trigger_type}:${year_observed ?? 0}` keys the
 * engine produced this pass. Any open / banker_reviewed auto-generated flag whose
 * key is absent has lost its source facts and is resolved.
 */
async function resolveStaleAutoFlags(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  liveFlagKeys: Set<string>,
): Promise<void> {
  try {
    const { data: existingFlags } = await (sb as any)
      .from("deal_flags")
      .select("id, trigger_type, year_observed")
      .eq("deal_id", dealId)
      .eq("auto_generated", true)
      .in("status", ["open", "banker_reviewed"]);

    for (const existing of (existingFlags ?? []) as Array<{ id: string; trigger_type: string; year_observed: number }>) {
      const key = `${existing.trigger_type}:${existing.year_observed ?? 0}`;
      if (!liveFlagKeys.has(key)) {
        await (sb as any)
          .from("deal_flags")
          .update({ status: "resolved", resolution_note: "Auto-resolved: source facts no longer support this flag" })
          .eq("id", existing.id);
      }
    }
  } catch (staleErr: any) {
    console.warn("[persistFlagReport] stale flag cleanup failed (non-fatal)", staleErr?.message);
  }

  // Direct safety net for OD detail-sum mismatch flags. Invariant: an open
  // auto-generated other_deductions_detail_sum_mismatch flag must never outlive
  // a live OD_DETAIL_TOTAL fact for its year. This holds independently of the
  // generic pass above (which depends on the engine's flag-key naming), so the
  // $9.73B-style stale mismatch can never re-stick after supersession.
  await resolveOrphanedOdMismatchFlags(sb, dealId);
}

async function resolveOrphanedOdMismatchFlags(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<void> {
  try {
    const { data: mismatchFlags } = await (sb as any)
      .from("deal_flags")
      .select("id, year_observed")
      .eq("deal_id", dealId)
      .eq("trigger_type", "other_deductions_detail_sum_mismatch")
      .eq("auto_generated", true)
      .in("status", ["open", "banker_reviewed"]);

    for (const flag of (mismatchFlags ?? []) as Array<{ id: string; year_observed: number }>) {
      const year = flag.year_observed;
      const { data: liveTotal } = await (sb as any)
        .from("deal_financial_facts")
        .select("id")
        .eq("deal_id", dealId)
        .eq("fact_key", "OD_DETAIL_TOTAL")
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .gte("fact_period_end", `${year}-01-01`)
        .lte("fact_period_end", `${year}-12-31`)
        .limit(1)
        .maybeSingle();

      if (!liveTotal?.id) {
        await (sb as any)
          .from("deal_flags")
          .update({ status: "resolved", resolution_note: "Auto-resolved: no live OD_DETAIL_TOTAL fact supports this mismatch flag" })
          .eq("id", flag.id);
      }
    }
  } catch (odErr: any) {
    console.warn("[persistFlagReport] OD mismatch safety cleanup failed (non-fatal)", odErr?.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function deleteStaleBorrowerQuestion(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  flag: SpreadFlag,
): Promise<void> {
  try {
    const yearObserved = flag.year_observed ?? 0;
    const { data: dbFlag } = await (sb as any)
      .from("deal_flags")
      .select("id")
      .eq("deal_id", dealId)
      .eq("trigger_type", flag.trigger_type)
      .eq("year_observed", yearObserved)
      .maybeSingle();

    if (!dbFlag?.id) return;

    const { error } = await (sb as any)
      .from("deal_borrower_questions")
      .delete()
      .eq("flag_id", dbFlag.id);

    if (error) {
      console.warn("[persistFlagReport] stale question delete failed", {
        dealId, flagId: dbFlag.id, error: error.message,
      });
    }
  } catch (err: any) {
    console.warn("[persistFlagReport] stale question cleanup threw", {
      dealId, error: err?.message,
    });
  }
}

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
