/**
 * maybeTriggerDealNaming — Belt-and-suspenders naming trigger.
 *
 * Call this from ANY completion point (upload session complete, artifact
 * batch processed, manual retry). It will:
 *
 *   1. Pre-flight: check if deal needs naming (not locked, not already derived)
 *   2. Evidence check: at least one classified doc with entity name exists
 *   3. If evidence present: call runNamingDerivation
 *   4. Emit pipeline ledger events for traceability
 *
 * Guarantees:
 *   - NEVER throws (fire-and-forget safe)
 *   - Idempotent (safe to call multiple times)
 *   - Does not depend on readiness
 *   - Respects existing throttle in runNamingDerivation
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type MaybeTriggerResult = {
  triggered: boolean;
  reason: string;
  outcome?: string;
  dealName?: string | null;
};

export async function maybeTriggerDealNaming(
  dealId: string,
  opts: {
    bankId: string;
    reason: string;
    documentId?: string;
  },
): Promise<MaybeTriggerResult> {
  const { bankId, reason, documentId } = opts;

  try {
    const sb = supabaseAdmin();

    // ── 1. Pre-flight: does the deal need naming? ────────────────────────
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, display_name, name, naming_method, name_locked")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return { triggered: false, reason: "deal_not_found" };
    }

    // Already locked — nothing to do
    if (deal.name_locked) {
      return { triggered: false, reason: "name_locked" };
    }

    // Already derived — idempotent
    const currentName = (deal as any).display_name ?? (deal as any).name ?? null;
    if ((deal as any).naming_method === "derived" && currentName) {
      return { triggered: false, reason: "already_derived", dealName: currentName };
    }

    // Manual override — respect it
    if ((deal as any).naming_method === "manual") {
      return { triggered: false, reason: "manual_override" };
    }

    // ── 2. Evidence check: at least one entity name in classified docs ───
    const { data: evidenceDocs, error: evidenceErr } = await sb
      .from("deal_documents")
      .select("ai_business_name, ai_borrower_name, match_confidence")
      .eq("deal_id", dealId)
      .not("document_type", "is", null)
      .limit(10);

    // Distinguish query failure from genuinely no docs
    if (evidenceErr) {
      console.warn("[maybeTriggerDealNaming] evidence query failed", {
        dealId,
        reason,
        error: evidenceErr.message,
      });
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "naming.trigger.skipped",
        uiState: "error",
        uiMessage: `Naming skipped: evidence query failed (trigger: ${reason})`,
        meta: { reason, trigger: reason, error: evidenceErr.message, fallback_reason: "evidence_query_failed" },
      });
      return { triggered: false, reason: "evidence_query_failed" };
    }

    if (!evidenceDocs || evidenceDocs.length === 0) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "naming.trigger.skipped",
        uiState: "waiting",
        uiMessage: `Naming skipped: no classified docs (trigger: ${reason})`,
        meta: { reason, trigger: reason, evidence_count: 0 },
      });
      return { triggered: false, reason: "no_classified_docs" };
    }

    // Check for any entity name evidence
    const hasEntityName = evidenceDocs.some(
      (d: any) => d.ai_business_name || d.ai_borrower_name,
    );

    if (!hasEntityName) {
      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "naming.trigger.skipped",
        uiState: "waiting",
        uiMessage: `Naming skipped: no entity names extracted (trigger: ${reason})`,
        meta: {
          reason,
          trigger: reason,
          classified_docs: evidenceDocs.length,
          has_entity_name: false,
        },
      });
      return { triggered: false, reason: "no_entity_names" };
    }

    // ── 3. Fire naming derivation ────────────────────────────────────────
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "naming.trigger.fired",
      uiState: "working",
      uiMessage: `Naming triggered: ${reason}`,
      meta: {
        trigger: reason,
        document_id: documentId ?? null,
        classified_docs: evidenceDocs.length,
        has_entity_name: true,
      },
    });

    const { runNamingDerivation } = await import("./runNamingDerivation");
    const result = await runNamingDerivation({ dealId, bankId, documentId });

    return {
      triggered: true,
      reason,
      outcome: result.outcome ?? (result.throttled ? "throttled" : "unknown"),
      dealName: result.dealNaming?.dealName ?? null,
    };
  } catch (err: any) {
    // NEVER throw — this is fire-and-forget safe
    console.warn("[maybeTriggerDealNaming] failed (non-fatal)", {
      dealId,
      reason,
      error: err?.message,
    });

    try {
      await logLedgerEvent({
        dealId,
        bankId: opts.bankId,
        eventKey: "naming.trigger.error",
        uiState: "error",
        uiMessage: `Naming trigger failed: ${err?.message ?? "unknown"}`,
        meta: { trigger: reason, error: err?.message },
      });
    } catch {
      // Double-safety: even ledger write failure won't throw
    }

    return { triggered: false, reason: `error: ${err?.message ?? "unknown"}` };
  }
}
