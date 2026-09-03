import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";
import { computeDealStructureFacts } from "./dealStructureFacts";

const SENTINEL_DATE = "1900-01-01";

/**
 * Write the deal-structure facts (loan total, project cost, equity, collateral
 * gross / net / discounted, LTV gross / net, discounted coverage) from the
 * latest loan request, the collateral schedule and proceeds items.
 *
 * Runs inside the spread job's canonical recompute so the facts the memo
 * readiness adapter and the financial snapshot need exist on every automatic
 * run — not only after a banker triggers the underwriting-synthesis route.
 * Idempotent: keyed on the loan request id (or the sentinel document when no
 * request exists yet), sentinel period, DEAL owner.
 */
export async function materializeDealStructureFacts(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; factsWritten: number; keys: string[]; notes: string[] } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();
    const [lrRes, collRes, proceedsRes] = await Promise.all([
      (sb as any)
        .from("deal_loan_requests")
        .select("id, requested_amount, approved_amount, property_value, purchase_price, down_payment, total_project_cost, updated_at")
        .eq("deal_id", args.dealId)
        .order("request_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (sb as any)
        .from("deal_collateral_items")
        .select("item_type, estimated_value, advance_rate")
        .eq("deal_id", args.dealId),
      (sb as any)
        .from("deal_proceeds_items")
        .select("amount")
        .eq("deal_id", args.dealId),
    ]);

    const lr = (lrRes?.data as any) ?? null;
    const collateral = ((collRes?.data ?? []) as any[]).map((c) => ({
      item_type: String(c.item_type ?? "general"),
      estimated_value: c.estimated_value === null || c.estimated_value === undefined ? null : Number(c.estimated_value),
      advance_rate: c.advance_rate === null || c.advance_rate === undefined ? null : Number(c.advance_rate),
    }));
    const proceedsRows = (proceedsRes?.data ?? []) as any[];
    const proceedsTotal = proceedsRows.length
      ? proceedsRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      : null;

    const { writes, notes } = computeDealStructureFacts({ loanRequest: lr, collateral, proceedsTotal });
    if (writes.length === 0) return { ok: true, factsWritten: 0, keys: [], notes };

    const asOf = typeof lr?.updated_at === "string" ? lr.updated_at.slice(0, 10) : null;
    const sourceDocId: string = lr?.id ?? SENTINEL_UUID;
    let written = 0;
    const keys: string[] = [];
    for (const w of writes) {
      const provenance: FinancialFactProvenance = {
        source_type: "MANUAL",
        source_ref: lr?.id ? `deal_loan_requests:${lr.id}` : `deal_collateral_items:${args.dealId}`,
        as_of_date: asOf,
        extractor: "materializeDealStructureFacts:v1",
        confidence: 0.95,
        citations: [],
        raw_snippets: [w.label],
      };
      const res = await upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: sourceDocId,
        factType: w.factType,
        factKey: w.factKey,
        factValueNum: w.value,
        confidence: 0.95,
        provenance,
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
        factPeriodStart: SENTINEL_DATE,
        factPeriodEnd: SENTINEL_DATE,
        allowSentinelPeriod: true,
      });
      if (res.ok) {
        written++;
        keys.push(w.canonicalKey);
      }
    }
    return { ok: true, factsWritten: written, keys, notes };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
