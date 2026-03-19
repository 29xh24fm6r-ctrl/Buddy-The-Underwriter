import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

export type GapResolution =
  | { action: "confirm"; factId: string; userId: string }
  | { action: "reject"; factId: string; userId: string }
  | { action: "resolve_conflict"; conflictId: string; winningFactId: string; userId: string }
  | { action: "provide_value"; gapId: string; factType: string; factKey: string; value: number | string; userId: string; dealId: string; bankId: string };

/**
 * Resolves a gap item. Writes back to deal_financial_facts and emits ledger event.
 * Called from both the UI gap panel and the voice/chat session handler.
 */
export async function resolveDealGap(
  resolution: GapResolution
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  try {
    if (resolution.action === "confirm") {
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", resolution.factId);

      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "confirmed" },
        })
        .eq("fact_id", resolution.factId)
        .eq("status", "open");

      // Get deal_id for ledger event
      const { data: fact } = await sb
        .from("deal_financial_facts")
        .select("deal_id, fact_key")
        .eq("id", resolution.factId)
        .maybeSingle();

      if (fact) {
        await writeEvent({
          dealId: fact.deal_id,
          kind: "fact.confirmed",
          actorUserId: resolution.userId,
          scope: "gap_resolution",
          action: "confirmed",
          meta: { fact_id: resolution.factId, fact_key: fact.fact_key },
        });
      }
    }

    if (resolution.action === "reject") {
      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "rejected", is_superseded: true })
        .eq("id", resolution.factId);

      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "rejected" },
        })
        .eq("fact_id", resolution.factId)
        .eq("status", "open");
    }

    if (resolution.action === "resolve_conflict") {
      // Mark conflict resolved
      await sb
        .from("deal_fact_conflicts")
        .update({
          status: "resolved",
          resolved_fact_id: resolution.winningFactId,
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", resolution.conflictId);

      // Mark the winning fact as confirmed, losers as rejected
      const { data: conflict } = await sb
        .from("deal_fact_conflicts")
        .select("conflicting_fact_ids")
        .eq("id", resolution.conflictId)
        .maybeSingle();

      const losingIds = (conflict?.conflicting_fact_ids ?? [])
        .filter((id: string) => id !== resolution.winningFactId);

      await sb
        .from("deal_financial_facts")
        .update({ resolution_status: "confirmed" })
        .eq("id", resolution.winningFactId);

      if (losingIds.length > 0) {
        await sb
          .from("deal_financial_facts")
          .update({ resolution_status: "rejected", is_superseded: true })
          .in("id", losingIds);
      }

      // Close the gap queue item
      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
        })
        .eq("conflict_id", resolution.conflictId)
        .eq("status", "open");
    }

    if (resolution.action === "provide_value") {
      // Banker is providing a value that didn't exist
      const valueNum = typeof resolution.value === "number" ? resolution.value : null;
      const valueText = typeof resolution.value === "string" ? resolution.value : null;

      await upsertDealFinancialFact({
        dealId: resolution.dealId,
        bankId: resolution.bankId,
        sourceDocumentId: null,
        factType: resolution.factType,
        factKey: resolution.factKey,
        factValueNum: valueNum,
        factValueText: valueText,
        confidence: 1.0,
        provenance: {
          source_type: "MANUAL",
          source_ref: `banker:${resolution.userId}`,
          as_of_date: new Date().toISOString().slice(0, 10),
          extractor: "gap_resolution:banker_provided",
          confidence: 1.0,
          citations: [],
          raw_snippets: [],
        },
      });

      // Resolve the gap
      await sb
        .from("deal_gap_queue")
        .update({
          status: "resolved",
          resolved_by: resolution.userId,
          resolved_at: new Date().toISOString(),
          resolution_meta: { action: "provided", value: resolution.value },
        })
        .eq("id", resolution.gapId)
        .eq("status", "open");

      await writeEvent({
        dealId: resolution.dealId,
        kind: "fact.banker_provided",
        actorUserId: resolution.userId,
        scope: "gap_resolution",
        action: "provided",
        meta: {
          fact_type: resolution.factType,
          fact_key: resolution.factKey,
          value: resolution.value,
          gap_id: resolution.gapId,
        },
      });
    }

    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
