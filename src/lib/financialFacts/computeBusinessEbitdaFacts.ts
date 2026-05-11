/**
 * SPEC-B4.1.2 — Canonical writer for entity-level slate-aware EBITDA.
 *
 * For each operating entity (OPCO) on the deal, reads tax-return-derived
 * facts, calls the slate-aware ebitdaEngine.computeEbitda function, and
 * writes the result as an entity-scoped EBITDA fact with methodology
 * provenance for the ebitda_addback_stack axis.
 *
 * Role in canonical chain:
 *   role: compute
 *   runsAfter: backfillCanonicalFactsFromSpreads
 *   runsBefore: runCashFlowAggregator
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import { computeSlateHash } from "@/lib/methodology/slateHash";
import { METHODOLOGY_AXES } from "@/lib/methodology/methodologyAxes";
import { DEFAULT_METHODOLOGY_SLATE } from "@/lib/methodology/methodologyDefaults";
import { buildRationale } from "@/lib/methodology/rationaleTemplates";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";
import type { MethodologyProvenance } from "@/lib/methodology/types";

const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

const EBITDA_INPUT_KEYS = [
  "ORDINARY_BUSINESS_INCOME",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
  "AMORTIZATION",
  "SECTION_179_EXPENSE",
  "BONUS_DEPRECIATION",
  "NON_RECURRING_EXPENSE",
  "NON_RECURRING_INCOME",
  "GUARANTEED_PAYMENTS",
  "COST_OF_GOODS_SOLD",
];

export type ComputeBusinessEbitdaResult =
  | {
      ok: true;
      entitiesProcessed: number;
      factsWritten: number;
      perEntity: Array<{
        entityId: string;
        adjustedEbitda: number | null;
        addBackCount: number;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

export async function computeBusinessEbitdaFacts(args: {
  dealId: string;
  bankId: string;
}): Promise<ComputeBusinessEbitdaResult> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  try {
    const { slate, isAllDefaults } = await loadDealMethodology(dealId, bankId);
    const slateHash = computeSlateHash(slate);

    // Only target OPCO entities — PROPCO uses NOI proxy, HOLDCO typically has no OBI
    const { data: entities, error: entitiesErr } = await (sb as any)
      .from("deal_entities")
      .select("id, name, entity_kind")
      .eq("deal_id", dealId)
      .eq("entity_kind", "OPCO");

    if (entitiesErr) {
      return { ok: false, error: `fetch entities: ${entitiesErr.message}` };
    }

    if (!entities || entities.length === 0) {
      return { ok: true, entitiesProcessed: 0, factsWritten: 0, perEntity: [] };
    }

    const ebitdaAxis = METHODOLOGY_AXES.ebitda_addback_stack;
    const ebitdaVariant = slate.ebitda_addback_stack;
    const methodologyProvenance: MethodologyProvenance[] = [
      {
        axis: "ebitda_addback_stack",
        chosen_variant: ebitdaVariant,
        alternatives_considered: ebitdaAxis.variants
          .map((v) => v.id)
          .filter((id) => id !== ebitdaVariant),
        rationale: buildRationale("ebitda_addback_stack", ebitdaVariant),
        slate_hash: slateHash,
        is_default:
          ebitdaVariant === DEFAULT_METHODOLOGY_SLATE.ebitda_addback_stack &&
          isAllDefaults,
      },
    ];

    const perEntity: Array<{ entityId: string; adjustedEbitda: number | null; addBackCount: number }> = [];
    let factsWritten = 0;

    for (const entity of entities as any[]) {
      const entityId = String(entity.id);

      // Read entity-scoped tax-return-derived facts
      const { data: factRows } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_key, fact_value_num, fact_period_end")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .in("fact_key", EBITDA_INPUT_KEYS)
        .order("fact_period_end", { ascending: false });

      if (!factRows || factRows.length === 0) {
        perEntity.push({ entityId, adjustedEbitda: null, addBackCount: 0 });
        continue;
      }

      const latestPeriod = (factRows as any[])[0].fact_period_end;
      const latestFacts = (factRows as any[]).filter(
        (r: any) => r.fact_period_end === latestPeriod,
      );

      const factMap: Record<string, number | null> = {};
      for (const k of EBITDA_INPUT_KEYS) {
        const row = latestFacts.find((r: any) => r.fact_key === k);
        factMap[k] = row?.fact_value_num ?? null;
      }

      // Detect partnership form type from guaranteed payments presence
      const formType = factMap.GUARANTEED_PAYMENTS !== null ? "FORM_1065" : "FORM_1120";

      const analysis = computeEbitda(factMap, formType, slate);

      perEntity.push({
        entityId,
        adjustedEbitda: analysis.adjustedEbitda,
        addBackCount: analysis.addBacks.length,
      });

      if (analysis.adjustedEbitda === null) continue;

      const result = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "EBITDA",
        factValueNum: analysis.adjustedEbitda,
        confidence: 0.9,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `computeBusinessEbitdaFacts:v1:${entityId}`,
          as_of_date: latestPeriod,
          extractor: "computeBusinessEbitdaFacts:v1",
          calc: analysis.adjustedEbitdaComponents,
          methodology: methodologyProvenance,
        },
        ownerType: "ENTITY",
        ownerEntityId: entityId,
        factPeriodStart: latestPeriod,
        factPeriodEnd: latestPeriod,
      });

      if (result.ok) factsWritten += 1;
    }

    return { ok: true, entitiesProcessed: entities.length, factsWritten, perEntity };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
