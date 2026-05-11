/**
 * SPEC-B4.1.2 — Canonical writer for entity-level slate-aware officer comp.
 *
 * For each OPCO entity, runs the slate-aware analyzeOfficerComp engine
 * and writes the excess-comp add-back as a fact with methodology
 * provenance for the officer_comp axis.
 *
 * Role in canonical chain:
 *   role: compute
 *   runsAfter: computeBusinessEbitdaFacts
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
import { analyzeOfficerComp } from "@/lib/financialIntelligence/officerCompEngine";
import type { MethodologyProvenance } from "@/lib/methodology/types";

const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";

const OFFICER_COMP_INPUT_KEYS = [
  "OFFICER_COMPENSATION",
  "GROSS_RECEIPTS",
  "GUARANTEED_PAYMENTS",
];

export type AnalyzeOfficerCompResult =
  | {
      ok: true;
      entitiesProcessed: number;
      factsWritten: number;
      perEntity: Array<{
        entityId: string;
        flag: string;
        excessComp: number | null;
      }>;
    }
  | {
      ok: false;
      error: string;
    };

export async function analyzeOfficerCompFacts(args: {
  dealId: string;
  bankId: string;
}): Promise<AnalyzeOfficerCompResult> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  try {
    const { slate, isAllDefaults } = await loadDealMethodology(dealId, bankId);
    const slateHash = computeSlateHash(slate);

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

    const officerCompAxis = METHODOLOGY_AXES.officer_comp;
    const officerCompVariant = slate.officer_comp;
    const methodologyProvenance: MethodologyProvenance[] = [
      {
        axis: "officer_comp",
        chosen_variant: officerCompVariant,
        alternatives_considered: officerCompAxis.variants
          .map((v) => v.id)
          .filter((id) => id !== officerCompVariant),
        rationale: buildRationale("officer_comp", officerCompVariant),
        slate_hash: slateHash,
        is_default:
          officerCompVariant === DEFAULT_METHODOLOGY_SLATE.officer_comp &&
          isAllDefaults,
      },
    ];

    const perEntity: Array<{ entityId: string; flag: string; excessComp: number | null }> = [];
    let factsWritten = 0;

    for (const entity of entities as any[]) {
      const entityId = String(entity.id);

      const { data: factRows } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_key, fact_value_num, fact_period_end")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
        .in("fact_key", OFFICER_COMP_INPUT_KEYS)
        .order("fact_period_end", { ascending: false });

      if (!factRows || factRows.length === 0) {
        perEntity.push({ entityId, flag: "INSUFFICIENT_DATA", excessComp: null });
        continue;
      }

      const latestPeriod = (factRows as any[])[0].fact_period_end;
      const latestFacts = (factRows as any[]).filter(
        (r: any) => r.fact_period_end === latestPeriod,
      );

      const factMap: Record<string, number | null> = {};
      for (const k of OFFICER_COMP_INPUT_KEYS) {
        const row = latestFacts.find((r: any) => r.fact_key === k);
        factMap[k] = row?.fact_value_num ?? null;
      }

      const formType = factMap.GUARANTEED_PAYMENTS !== null ? "FORM_1065" : "FORM_1120";
      const analysis = analyzeOfficerComp(factMap, formType, slate);

      perEntity.push({
        entityId,
        flag: analysis.flag,
        excessComp: analysis.excessComp,
      });

      const addBackValue = analysis.adjustedEbitdaImpact ?? 0;

      const result = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "OFFICER_COMP_EXCESS_ADDBACK",
        factValueNum: addBackValue,
        confidence: 0.85,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `analyzeOfficerCompFacts:v1:${entityId}`,
          as_of_date: latestPeriod,
          extractor: "analyzeOfficerCompFacts:v1",
          calc: analysis.notes || `Officer comp flag: ${analysis.flag}`,
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
