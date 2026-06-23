/**
 * SPEC-B4.1.2 — Canonical writer for entity-level slate-aware EBITDA.
 * SPEC-B4.1.4 — Conditional officer-comp fold-in per methodology contract.
 *
 * For each operating entity (OPCO) on the deal, reads tax-return-derived
 * facts, calls the slate-aware ebitdaEngine.computeEbitda function. When
 * the methodology slate's ebitda_addback_stack is "aggressive" AND
 * officer_comp is not "no_normalization", additionally calls
 * analyzeOfficerComp and folds the excess-comp addback into the EBITDA
 * value before persisting. Otherwise EBITDA is persisted as-is and
 * officer-comp remains a separate observational fact written by
 * analyzeOfficerCompFacts.
 *
 * Methodology provenance attached to the EBITDA fact carries an
 * ebitda_addback_stack axis entry always, plus an officer_comp axis
 * entry when the fold-in applied.
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
import { analyzeOfficerComp } from "@/lib/financialIntelligence/officerCompEngine";
import { applyOfficerCompFoldIn } from "@/lib/methodology/applyOfficerCompFoldIn";
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
  // SPEC-B4.1.4 — officer-comp inputs needed by analyzeOfficerComp for conditional fold-in
  "OFFICER_COMPENSATION",
  "GROSS_RECEIPTS",
  // SPEC-CANONICAL-DSCR-NCADS-PERFECTION-PROGRAM-1 Phase 1 — C-corp (Form 1120) EBITDA
  // base inputs (no ORDINARY_BUSINESS_INCOME): pre-tax TAXABLE_INCOME, else NET_INCOME
  // reconstructed via the tax provision.
  "TAXABLE_INCOME",
  "NET_INCOME",
  "TOTAL_TAX",
  "M1_FEDERAL_TAX_BOOK",
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

      // SPEC-B4.1.4 — conditional officer-comp fold-in per methodology contract.
      // Policy lives in applyOfficerCompFoldIn; this writer and the picker's
      // projection MUST both go through that helper to stay in lockstep.
      const officerCompAnalysis = analyzeOfficerComp(factMap, formType, slate);
      const foldInDecision = applyOfficerCompFoldIn({
        slate,
        officerCompAdjustedEbitdaImpact: officerCompAnalysis.adjustedEbitdaImpact,
      });

      const finalEbitda =
        analysis.adjustedEbitda !== null
          ? analysis.adjustedEbitda + foldInDecision.foldInAmount
          : null;

      perEntity.push({
        entityId,
        adjustedEbitda: finalEbitda,
        addBackCount: analysis.addBacks.length + (foldInDecision.shouldFold ? 1 : 0),
      });

      if (finalEbitda === null) continue;

      // SPEC-B4.1.4 — augment provenance with officer_comp axis only when fold-in applied
      const entityMethodologyProvenance: MethodologyProvenance[] = [...methodologyProvenance];
      if (foldInDecision.shouldFold) {
        const officerCompAxisDef = METHODOLOGY_AXES.officer_comp;
        const officerCompVariant = slate.officer_comp;
        entityMethodologyProvenance.push({
          axis: "officer_comp",
          chosen_variant: officerCompVariant,
          alternatives_considered: officerCompAxisDef.variants
            .map((v) => v.id)
            .filter((id) => id !== officerCompVariant),
          rationale: buildRationale("officer_comp", officerCompVariant),
          slate_hash: slateHash,
          is_default:
            officerCompVariant === DEFAULT_METHODOLOGY_SLATE.officer_comp && isAllDefaults,
        });
      }

      const calcString = foldInDecision.shouldFold
        ? `${analysis.adjustedEbitdaComponents} + Officer Comp Normalization $${foldInDecision.foldInAmount.toLocaleString("en-US")}`
        : analysis.adjustedEbitdaComponents;

      const result = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "EBITDA",
        factValueNum: finalEbitda,
        confidence: 0.9,
        provenance: {
          source_type: "STRUCTURAL",
          source_ref: `computeBusinessEbitdaFacts:v2:${entityId}`,
          as_of_date: latestPeriod,
          extractor: "computeBusinessEbitdaFacts:v2",
          calc: calcString,
          methodology: entityMethodologyProvenance,
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
