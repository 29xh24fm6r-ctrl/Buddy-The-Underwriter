import "server-only";

/**
 * Global Cash Flow — Server-side Persistence Layer
 *
 * Reads entity and personal income facts from DB, calls the pure
 * computeGlobalCashFlow function, and writes GCF_GLOBAL_CASH_FLOW
 * and GCF_DSCR back as canonical facts.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { CANONICAL_FACTS } from "@/lib/financialFacts/keys";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { selectBestFact } from "@/lib/financialFacts/selectBestFact";
import {
  computeGlobalCashFlow,
  type GcfEntityInput,
  type GcfSponsorInput,
  type GcfResult,
} from "./computeGlobalCashFlow";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import { computeSlateHash } from "@/lib/methodology/slateHash";
import { METHODOLOGY_AXES } from "@/lib/methodology/methodologyAxes";
import { DEFAULT_METHODOLOGY_SLATE } from "@/lib/methodology/methodologyDefaults";
import { buildRationale } from "@/lib/methodology/rationaleTemplates";
import type { MethodologyProvenance } from "@/lib/methodology/types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function persistGlobalCashFlow(args: {
  dealId: string;
  bankId: string;
}): Promise<
  | { ok: true; result: GcfResult; factsWritten: number; notes: string[] }
  | { ok: false; error: string }
> {
  try {
    const sb = supabaseAdmin();
    const notes: string[] = [];

    // SPEC-B4 — Load methodology slate (banker choices merged over defaults)
    const { slate: methodologySlate, isAllDefaults } =
      await loadDealMethodology(args.dealId, args.bankId);
    const slateHash = computeSlateHash(methodologySlate);

    // ── 1. Load deal entities ──────────────────────────────────────────────
    const { data: entityRows, error: entErr } = await (sb as any)
      .from("deal_entities")
      .select("id, name, entity_kind, ownership_percent")
      .eq("deal_id", args.dealId);

    if (entErr) {
      return { ok: false, error: `entity_load_failed: ${entErr.message}` };
    }

    // ── 2. Load all financial facts for this deal ──────────────────────────
    const { data: factRows, error: factErr } = await (sb as any)
      .from("deal_financial_facts")
      .select(
        "id, fact_type, fact_key, fact_value_num, fact_value_text, fact_period_start, fact_period_end, confidence, provenance, created_at, owner_type, owner_entity_id, source_canonical_type",
      )
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId)
      .eq("is_superseded", false);

    if (factErr) {
      return { ok: false, error: `fact_load_failed: ${factErr.message}` };
    }

    const facts = (factRows ?? []) as any[];

    // SPEC-FACT-DISAMBIGUATION-1: use selectBestFact for priority-based selection
    function findFact(opts: {
      factType: string;
      factKey: string;
      ownerType?: string;
      ownerEntityId?: string;
      sourceCanonicalType?: string;
    }): number | null {
      let candidates = facts.filter((f: any) => {
        if (f.fact_type !== opts.factType) return false;
        if (f.fact_key !== opts.factKey) return false;
        if (opts.ownerType && f.owner_type !== opts.ownerType) return false;
        if (opts.ownerEntityId && f.owner_entity_id !== opts.ownerEntityId) return false;
        if (opts.sourceCanonicalType && f.source_canonical_type !== opts.sourceCanonicalType) return false;
        return true;
      });
      const { chosen } = selectBestFact(candidates);
      return chosen?.fact_value_num ?? null;
    }

    // ── 3. Build entity inputs ─────────────────────────────────────────────
    const entities: GcfEntityInput[] = [];
    const operatingKinds = new Set(["OPCO", "PROPCO", "HOLDCO"]);

    // Filter out unnamed placeholders (auto-seeded rows with no real data)
    const usableEntityRows = (entityRows ?? []).filter(
      (e: any) =>
        e.name &&
        e.name !== "Unassigned Business" &&
        e.name !== "Unassigned Owner" &&
        e.ownership_percent !== null,
    );

    for (const ent of usableEntityRows) {
      if (!operatingKinds.has(ent.entity_kind)) continue;

      const entityId = ent.id as string;
      const entityName = (ent.name ?? "Unknown Entity") as string;
      const ownershipPct =
        typeof ent.ownership_percent === "number"
          ? ent.ownership_percent / 100
          : null;

      const netIncome =
        findFact({ factType: "FINANCIAL_ANALYSIS", factKey: "NOI_TTM" }) ??
        findFact({ factType: "FINANCIAL_ANALYSIS", factKey: "EBITDA" }) ??
        findFact({
          factType: "FINANCIAL_ANALYSIS",
          factKey: "CASH_FLOW_AVAILABLE",
        });

      const depreciation = findFact({
        factType: "TAX_RETURN",
        factKey: "DEPRECIATION",
      });

      const interestExpense = null;

      const debtService = findFact({
        factType: "FINANCIAL_ANALYSIS",
        factKey: "ANNUAL_DEBT_SERVICE",
      });

      entities.push({
        entityId,
        entityName,
        entityType: ent.entity_kind === "PROPCO" ? "PASSTHROUGH" : "OPERATING",
        ownershipPct,
        netIncome,
        depreciation,
        interestExpense,
        debtService,
      });
    }

    // ── 3a. Fallback: ownership_entities when deal_entities is empty ──────
    if (entities.length === 0) {
      const { data: ownershipRows } = await (sb as any)
        .from("ownership_entities")
        .select("id, display_name, entity_type, ownership_pct")
        .eq("deal_id", args.dealId)
        .eq("entity_type", "company");

      for (const ent of ownershipRows ?? []) {
        const entityId = ent.id as string;
        const entityName = (ent.display_name ?? "Borrower Entity") as string;
        const ownershipPct =
          typeof ent.ownership_pct === "number" ? ent.ownership_pct / 100 : 1.0;

        const netIncome =
          findFact({ factType: "FINANCIAL_ANALYSIS", factKey: "EBITDA" }) ??
          findFact({ factType: "TAX_RETURN", factKey: "NET_INCOME" }) ??
          findFact({ factType: "TAX_RETURN", factKey: "GROSS_RECEIPTS" });

        const depreciation = findFact({
          factType: "TAX_RETURN",
          factKey: "DEPRECIATION",
        });

        const debtService = findFact({
          factType: "FINANCIAL_ANALYSIS",
          factKey: "ANNUAL_DEBT_SERVICE",
        });

        entities.push({
          entityId,
          entityName,
          entityType: "OPERATING",
          ownershipPct,
          netIncome,
          depreciation,
          interestExpense: null,
          debtService,
        });
      }

      if (entities.length > 0) {
        notes.push(
          `deal_entities empty — fell back to ${entities.length} ownership_entities row(s) for GCF computation`,
        );
      }
    }

    if (entities.length === 0) {
      notes.push("No operating entities found — entity cash flow will be null");
    }

    // ── 4. Build sponsor inputs ────────────────────────────────────────────
    const sponsors: GcfSponsorInput[] = [];
    const personalEntityIds = new Set<string>();

    // Find all PERSONAL owners from facts
    for (const f of facts) {
      if (f.owner_type === "PERSONAL" && f.owner_entity_id) {
        personalEntityIds.add(f.owner_entity_id);
      }
    }

    // Also include PERSON entities from deal_entities
    for (const ent of usableEntityRows) {
      if (ent.entity_kind === "PERSON") {
        personalEntityIds.add(ent.id as string);
      }
    }

    // Fallback: ownership_entities individuals when no PERSONAL facts
    if (personalEntityIds.size === 0) {
      const { data: personRows } = await (sb as any)
        .from("ownership_entities")
        .select("id, display_name, ownership_pct")
        .eq("deal_id", args.dealId)
        .eq("entity_type", "individual");

      for (const p of personRows ?? []) {
        personalEntityIds.add(p.id as string);
      }
    }

    for (const ownerId of personalEntityIds) {
      const ownerName =
        usableEntityRows.find((e: any) => e.id === ownerId)?.name ??
        "Sponsor";

      const totalPersonalIncome = findFact({
        factType: "PERSONAL_INCOME",
        factKey: "TOTAL_PERSONAL_INCOME",
        ownerType: "PERSONAL",
        ownerEntityId: ownerId,
      });

      // Personal obligations from PFS
      const personalObligations = findFact({
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_ANNUAL_DEBT_SERVICE",
        ownerType: "PERSONAL",
        ownerEntityId: ownerId,
      });

      sponsors.push({
        ownerId,
        ownerName: ownerName as string,
        totalPersonalIncome,
        personalObligations,
      });
    }

    if (sponsors.length === 0) {
      notes.push(
        "No personal income data found — sponsor cash flow will be null",
      );
    }

    // ── 5. Load deal-level debt service ────────────────────────────────────
    const proposedDebtService = findFact({
      factType: "FINANCIAL_ANALYSIS",
      factKey: "ANNUAL_DEBT_SERVICE_PROPOSED",
    });
    const existingDebtService = findFact({
      factType: "FINANCIAL_ANALYSIS",
      factKey: "ANNUAL_DEBT_SERVICE_EXISTING",
    });

    // ── 6. Compute ─────────────────────────────────────────────────────────
    const result = computeGlobalCashFlow(
      {
        entities,
        sponsors,
        proposedDebtService,
        existingDebtService,
      },
      methodologySlate,
    );

    // SPEC-B4 — GCF facts are affected by Axis 4 (affiliate_ownership) and
    // Axis 5 (living_expense). Provenance is a 2-element array (always-array
    // shape; readers iterate uniformly).
    const ownershipAxis = METHODOLOGY_AXES.affiliate_ownership;
    const livingExpenseAxis = METHODOLOGY_AXES.living_expense;

    const methodologyProvenance: MethodologyProvenance[] = [
      {
        axis: "affiliate_ownership",
        chosen_variant: methodologySlate.affiliate_ownership,
        alternatives_considered: ownershipAxis.variants
          .map((v) => v.id)
          .filter((id) => id !== methodologySlate.affiliate_ownership),
        rationale: buildRationale(
          "affiliate_ownership",
          methodologySlate.affiliate_ownership,
        ),
        slate_hash: slateHash,
        is_default:
          methodologySlate.affiliate_ownership ===
            DEFAULT_METHODOLOGY_SLATE.affiliate_ownership && isAllDefaults,
      },
      {
        axis: "living_expense",
        chosen_variant: methodologySlate.living_expense,
        alternatives_considered: livingExpenseAxis.variants
          .map((v) => v.id)
          .filter((id) => id !== methodologySlate.living_expense),
        rationale: buildRationale(
          "living_expense",
          methodologySlate.living_expense,
        ),
        slate_hash: slateHash,
        is_default:
          methodologySlate.living_expense ===
            DEFAULT_METHODOLOGY_SLATE.living_expense && isAllDefaults,
      },
    ];

    // ── 7. Persist GCF facts ───────────────────────────────────────────────
    let factsWritten = 0;
    const writes: Array<Promise<{ ok: boolean; error?: string }>> = [];

    // GCF_GLOBAL_CASH_FLOW
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_type,
        factKey: CANONICAL_FACTS.GCF_GLOBAL_CASH_FLOW.fact_key,
        factValueNum: result.globalCashFlowAvailable,
        confidence: result.globalCashFlowAvailable === null ? null : 0.85,
        provenance: {
          source_type: "SPREAD",
          source_ref: "computeGlobalCashFlow:v2",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v2",
          calc: "entity_cash_flow + personal_cash_flow",
          confidence: result.globalCashFlowAvailable === null ? null : 0.85,
          methodology: methodologyProvenance,
        },
      }),
    );

    // GCF_DSCR
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.GCF_DSCR.fact_type,
        factKey: CANONICAL_FACTS.GCF_DSCR.fact_key,
        factValueNum: result.globalDscr,
        confidence: result.globalDscr === null ? null : 0.85,
        provenance: {
          source_type: "SPREAD",
          source_ref: "computeGlobalCashFlow:v2",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v2",
          calc: "global_cash_flow_available / total_debt_service",
          confidence: result.globalDscr === null ? null : 0.85,
          methodology: methodologyProvenance,
        },
      }),
    );

    // GLOBAL_CASH_FLOW (legacy key — write same value for compat)
    writes.push(
      upsertDealFinancialFact({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: null,
        factType: CANONICAL_FACTS.GLOBAL_CASH_FLOW.fact_type,
        factKey: CANONICAL_FACTS.GLOBAL_CASH_FLOW.fact_key,
        factValueNum: result.globalCashFlowAvailable,
        confidence: result.globalCashFlowAvailable === null ? null : 0.85,
        provenance: {
          source_type: "SPREAD",
          source_ref: "computeGlobalCashFlow:v2",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v2",
          calc: "entity_cash_flow + personal_cash_flow (legacy compat)",
          confidence: result.globalCashFlowAvailable === null ? null : 0.85,
          methodology: methodologyProvenance,
        },
      }),
    );

    const results = await Promise.all(writes);
    for (const r of results) {
      if (r.ok) factsWritten += 1;
      else notes.push(`gcf_fact_write_failed: ${r.error ?? "unknown"}`);
    }

    notes.push(...result.warnings);

    return { ok: true, result, factsWritten, notes };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
