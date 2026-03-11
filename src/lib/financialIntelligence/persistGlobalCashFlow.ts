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
import {
  computeGlobalCashFlow,
  type GcfEntityInput,
  type GcfSponsorInput,
  type GcfResult,
} from "./computeGlobalCashFlow";

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
        "fact_type, fact_key, fact_value_num, owner_type, owner_entity_id",
      )
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId);

    if (factErr) {
      return { ok: false, error: `fact_load_failed: ${factErr.message}` };
    }

    const facts = (factRows ?? []) as Array<{
      fact_type: string;
      fact_key: string;
      fact_value_num: number | null;
      owner_type: string | null;
      owner_entity_id: string | null;
    }>;

    // Helper: find fact value
    function findFact(opts: {
      factType: string;
      factKey: string;
      ownerType?: string;
      ownerEntityId?: string;
    }): number | null {
      const match = facts.find((f) => {
        if (f.fact_type !== opts.factType) return false;
        if (f.fact_key !== opts.factKey) return false;
        if (opts.ownerType && f.owner_type !== opts.ownerType) return false;
        if (opts.ownerEntityId && f.owner_entity_id !== opts.ownerEntityId)
          return false;
        return true;
      });
      return match?.fact_value_num ?? null;
    }

    // ── 3. Build entity inputs ─────────────────────────────────────────────
    const entities: GcfEntityInput[] = [];
    const operatingKinds = new Set(["OPCO", "PROPCO", "HOLDCO"]);

    for (const ent of entityRows ?? []) {
      if (!operatingKinds.has(ent.entity_kind)) continue;

      const entityId = ent.id as string;
      const entityName = (ent.name ?? "Unknown Entity") as string;
      const ownershipPct =
        typeof ent.ownership_percent === "number"
          ? ent.ownership_percent / 100
          : null;

      // Try entity-level NOI/income from tax return or IS facts
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

      const interestExpense = null; // Not separately captured yet

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
    for (const ent of entityRows ?? []) {
      if (ent.entity_kind === "PERSON") {
        personalEntityIds.add(ent.id as string);
      }
    }

    for (const ownerId of personalEntityIds) {
      const ownerName =
        (entityRows ?? []).find((e: any) => e.id === ownerId)?.name ??
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
    const result = computeGlobalCashFlow({
      entities,
      sponsors,
      proposedDebtService,
      existingDebtService,
    });

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
          source_ref: "computeGlobalCashFlow:v1",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v1",
          calc: "entity_cash_flow + personal_cash_flow",
          confidence: result.globalCashFlowAvailable === null ? null : 0.85,
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
          source_ref: "computeGlobalCashFlow:v1",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v1",
          calc: "global_cash_flow_available / total_debt_service",
          confidence: result.globalDscr === null ? null : 0.85,
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
          source_ref: "computeGlobalCashFlow:v1",
          as_of_date: null,
          extractor: "persistGlobalCashFlow:v1",
          calc: "entity_cash_flow + personal_cash_flow (legacy compat)",
          confidence: result.globalCashFlowAvailable === null ? null : 0.85,
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
