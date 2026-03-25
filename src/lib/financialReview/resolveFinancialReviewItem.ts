import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import {
  validateResolutionInput,
  ACTION_TO_STATUS,
  type ResolutionInput,
  type GapType,
  type ResolvedStatus,
} from "./validateResolutionInput";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolveArgs = ResolutionInput & {
  dealId: string;
  bankId: string;
  actorUserId: string;
  actorRole: string;
};

type ResolveResult =
  | {
      ok: true;
      resolution: {
        gapId: string;
        resolvedStatus: ResolvedStatus;
        action: string;
        resolvedValue: number | null;
        rationale: string | null;
        resolvedAt: string;
      };
    }
  | { ok: false; error: string; errors?: Array<{ field: string; message: string }> };

// ---------------------------------------------------------------------------
// Audit event keys
// ---------------------------------------------------------------------------

const EVENT_KEY: Record<string, string> = {
  confirm_value:       "financial_review.confirmed",
  choose_source_value: "financial_review.source_selected",
  override_value:      "financial_review.overridden",
  provide_value:       "financial_review.provided",
  mark_follow_up:      "financial_review.follow_up_marked",
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export async function resolveFinancialReviewItem(
  args: ResolveArgs,
): Promise<ResolveResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    // 1. Load gap
    const { data: gap, error: gapErr } = await sb
      .from("deal_gap_queue")
      .select("id, deal_id, bank_id, gap_type, fact_key, fact_type, fact_id, conflict_id, description")
      .eq("id", args.gapId)
      .eq("status", "open")
      .maybeSingle();

    if (gapErr || !gap) {
      return { ok: false, error: "gap_not_found" };
    }

    // 2. Verify deal/bank scope
    if (gap.deal_id !== args.dealId || gap.bank_id !== args.bankId) {
      return { ok: false, error: "forbidden" };
    }

    const gapType = gap.gap_type as GapType;

    // 3. Validate input
    const validationErrors = validateResolutionInput(args, gapType);
    if (validationErrors.length > 0) {
      return { ok: false, error: "validation_failed", errors: validationErrors };
    }

    const resolvedStatus = ACTION_TO_STATUS[args.action];

    // 4. Load provenance snapshot for audit
    let provenanceSnapshot: Record<string, unknown> = {};
    if (gap.fact_id) {
      const { data: fact } = await sb
        .from("deal_financial_facts")
        .select("fact_value_num, fact_period_start, fact_period_end, confidence, provenance, source_document_id")
        .eq("id", gap.fact_id)
        .maybeSingle();

      if (fact) {
        let sourceDocName: string | null = null;
        if (fact.source_document_id) {
          const { data: doc } = await sb
            .from("deal_documents")
            .select("original_filename, document_type")
            .eq("id", fact.source_document_id)
            .maybeSingle();
          sourceDocName = doc?.original_filename ?? doc?.document_type ?? null;
        }

        provenanceSnapshot = {
          value: fact.fact_value_num,
          periodStart: fact.fact_period_start,
          periodEnd: fact.fact_period_end,
          confidence: fact.confidence,
          sourceDocumentName: sourceDocName,
          sourceLineLabel: (fact.provenance as any)?.source_ref ?? null,
          extractionPath: (fact.provenance as any)?.extractor ?? null,
        };
      }
    }

    const priorValue = (provenanceSnapshot as any).value ?? null;

    // 5. Execute action-specific logic
    if (args.action === "confirm_value") {
      // Accept Buddy's extracted value
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", args.factId!);

      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_by: args.actorUserId, resolved_at: now, resolution_meta: { action: args.action, resolved_status: resolvedStatus } })
        .eq("id", gap.id);
    }

    if (args.action === "choose_source_value") {
      // Select one of the competing source values
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", args.factId!);

      // If conflict exists, mark it resolved
      if (gap.conflict_id) {
        const { data: conflict } = await sb
          .from("deal_fact_conflicts")
          .select("conflicting_fact_ids")
          .eq("id", gap.conflict_id)
          .maybeSingle();

        await sb
          .from("deal_fact_conflicts")
          .update({ status: "resolved", resolved_fact_id: args.factId!, resolved_by: args.actorUserId, resolved_at: now })
          .eq("id", gap.conflict_id);

        // Mark losing facts as rejected
        const losingIds = (conflict?.conflicting_fact_ids ?? []).filter((id: string) => id !== args.factId);
        if (losingIds.length > 0) {
          await sb
            .from("deal_financial_facts")
            .update({ resolution_status: "rejected", is_superseded: true })
            .in("id", losingIds);
        }
      }

      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_by: args.actorUserId, resolved_at: now, resolution_meta: { action: args.action, resolved_status: resolvedStatus, selected_fact_id: args.factId } })
        .eq("id", gap.id);
    }

    if (args.action === "override_value") {
      // Supersede existing fact, insert banker override
      if (gap.fact_id) {
        await sb
          .from("deal_financial_facts")
          .update({ resolution_status: "overridden", is_superseded: true })
          .eq("id", gap.fact_id);
      }

      await upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: gap.fact_type,
        factKey: gap.fact_key,
        factValueNum: args.resolvedValue!,
        confidence: 1.0,
        factPeriodStart: args.resolvedPeriodStart,
        factPeriodEnd: args.resolvedPeriodEnd,
        provenance: {
          source_type: "MANUAL",
          source_ref: `banker_override:${args.actorUserId}`,
          as_of_date: now.slice(0, 10),
          extractor: "financial_review:override",
          confidence: 1.0,
          citations: [],
          raw_snippets: [],
        },
      });

      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_by: args.actorUserId, resolved_at: now, resolution_meta: { action: args.action, resolved_status: resolvedStatus, override_value: args.resolvedValue } })
        .eq("id", gap.id);
    }

    if (args.action === "provide_value") {
      // Banker provides a missing value
      await upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: gap.fact_type,
        factKey: gap.fact_key,
        factValueNum: args.resolvedValue!,
        confidence: 1.0,
        factPeriodStart: args.resolvedPeriodStart,
        factPeriodEnd: args.resolvedPeriodEnd,
        provenance: {
          source_type: "MANUAL",
          source_ref: `banker_provided:${args.actorUserId}`,
          as_of_date: now.slice(0, 10),
          extractor: "financial_review:provided",
          confidence: 1.0,
          citations: [],
          raw_snippets: [],
        },
      });

      await sb
        .from("deal_gap_queue")
        .update({ status: "resolved", resolved_by: args.actorUserId, resolved_at: now, resolution_meta: { action: args.action, resolved_status: resolvedStatus, provided_value: args.resolvedValue } })
        .eq("id", gap.id);
    }

    if (args.action === "mark_follow_up") {
      // Defer — keep visible as deferred, not resolved
      await sb
        .from("deal_gap_queue")
        .update({ status: "deferred", resolved_by: args.actorUserId, resolved_at: now, resolution_meta: { action: args.action, resolved_status: resolvedStatus, rationale: args.rationale } })
        .eq("id", gap.id);
    }

    // 6. Persist resolution record
    await sb.from("financial_review_resolutions").insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      gap_id: gap.id,
      fact_key: gap.fact_key,
      gap_type: gapType,
      action: args.action,
      resolved_status: resolvedStatus,
      selected_fact_id: args.factId ?? null,
      selected_conflict_id: gap.conflict_id ?? null,
      prior_value: priorValue,
      resolved_value: args.resolvedValue ?? priorValue,
      resolved_period_start: args.resolvedPeriodStart ?? null,
      resolved_period_end: args.resolvedPeriodEnd ?? null,
      rationale: args.rationale ?? null,
      provenance_snapshot: provenanceSnapshot,
      actor_user_id: args.actorUserId,
      actor_role: args.actorRole,
    });

    // 7. Audit event
    await writeEvent({
      dealId: args.dealId,
      kind: EVENT_KEY[args.action] ?? "financial_review.unknown",
      actorUserId: args.actorUserId,
      scope: "financial_review",
      action: args.action,
      meta: {
        gap_id: gap.id,
        fact_key: gap.fact_key,
        gap_type: gapType,
        resolved_status: resolvedStatus,
        prior_value: priorValue,
        resolved_value: args.resolvedValue ?? null,
        selected_fact_id: args.factId ?? null,
        selected_conflict_id: gap.conflict_id ?? null,
        rationale: args.rationale ?? null,
        provenance_snapshot: provenanceSnapshot,
        actor_role: args.actorRole,
      },
    });

    return {
      ok: true,
      resolution: {
        gapId: gap.id,
        resolvedStatus,
        action: args.action,
        resolvedValue: args.resolvedValue ?? priorValue,
        rationale: args.rationale ?? null,
        resolvedAt: now,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[resolveFinancialReviewItem]", msg);
    return { ok: false, error: msg };
  }
}
