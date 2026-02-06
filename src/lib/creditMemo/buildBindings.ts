import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectPeriods } from "@/lib/creditMemo/selectPeriods";
import type {
  CreditMemoBindings,
  CreditMemoProvenance,
  SponsorBinding,
} from "@/lib/creditMemo/bindings";

type FactRow = {
  id: string;
  fact_type: string;
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_period_start: string | null;
  fact_period_end: string | null;
  confidence: number | null;
  provenance: any;
  source_document_id: string | null;
  owner_type: string;
  owner_entity_id: string | null;
  created_at: string;
};

/**
 * Build the complete credit memo bindings from deal_financial_facts.
 *
 * Every numeric field that ends up in the memo gets a provenance entry.
 * Values come from facts — never from client-side math.
 */
export async function buildCreditMemoBindings(args: {
  dealId: string;
  bankId: string;
}): Promise<CreditMemoBindings> {
  const { dealId, bankId } = args;
  const sb = supabaseAdmin();

  // 1. Load all facts for this deal
  const { data: factRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false });

  const facts = (factRows ?? []) as FactRow[];

  // 2. Select periods
  const periods = await selectPeriods({ dealId, bankId });

  // 3. Build provenance collector
  const provenance: CreditMemoProvenance[] = [];

  function bindFact(args: {
    memoField: string;
    factType: string;
    factKey: string;
    ownerType: "DEAL" | "PERSONAL" | "GLOBAL";
    ownerEntityId?: string | null;
  }): number | null {
    // Find best matching fact (most recent by created_at — already sorted desc)
    const match = facts.find((f) => {
      if (f.fact_type !== args.factType) return false;
      if (f.fact_key !== args.factKey) return false;
      if (args.ownerType === "PERSONAL") {
        if (f.owner_type !== "PERSONAL") return false;
        if (args.ownerEntityId && f.owner_entity_id !== args.ownerEntityId) return false;
      } else if (args.ownerType === "DEAL") {
        if (f.owner_type !== "DEAL" && f.owner_type) return false;
      }
      return true;
    });

    const value = match?.fact_value_num ?? null;
    const source = match
      ? `Facts:${args.factType}.${args.factKey}`
      : "Missing";

    provenance.push({
      memoField: args.memoField,
      factType: args.factType,
      factKey: args.factKey,
      ownerType: args.ownerType,
      ownerEntityId: args.ownerEntityId ?? null,
      periodStart: match?.fact_period_start ?? null,
      periodEnd: match?.fact_period_end ?? null,
      sourceDocumentId: match?.source_document_id ?? null,
      confidence: match?.confidence ?? null,
      source,
    });

    return value;
  }

  // 4. Bind DEAL-level property metrics
  const property = {
    noi: bindFact({ memoField: "property.noi", factType: "FINANCIAL_ANALYSIS", factKey: "NOI_TTM", ownerType: "DEAL" }),
    totalIncome: bindFact({ memoField: "property.totalIncome", factType: "FINANCIAL_ANALYSIS", factKey: "TOTAL_INCOME_TTM", ownerType: "DEAL" }),
    opex: bindFact({ memoField: "property.opex", factType: "FINANCIAL_ANALYSIS", factKey: "OPEX_TTM", ownerType: "DEAL" }),
    cashFlowAvailable: bindFact({ memoField: "property.cashFlowAvailable", factType: "FINANCIAL_ANALYSIS", factKey: "CASH_FLOW_AVAILABLE", ownerType: "DEAL" }),
    debtService: bindFact({ memoField: "property.debtService", factType: "FINANCIAL_ANALYSIS", factKey: "ANNUAL_DEBT_SERVICE", ownerType: "DEAL" }),
    excessCashFlow: bindFact({ memoField: "property.excessCashFlow", factType: "FINANCIAL_ANALYSIS", factKey: "EXCESS_CASH_FLOW", ownerType: "DEAL" }),
    dscr: bindFact({ memoField: "property.dscr", factType: "FINANCIAL_ANALYSIS", factKey: "DSCR", ownerType: "DEAL" }),
    dscrStressed: bindFact({ memoField: "property.dscrStressed", factType: "FINANCIAL_ANALYSIS", factKey: "DSCR_STRESSED_300BPS", ownerType: "DEAL" }),
    ltvGross: bindFact({ memoField: "property.ltvGross", factType: "COLLATERAL", factKey: "LTV_GROSS", ownerType: "DEAL" }),
    ltvNet: bindFact({ memoField: "property.ltvNet", factType: "COLLATERAL", factKey: "LTV_NET", ownerType: "DEAL" }),
    occupancyPct: bindFact({ memoField: "property.occupancyPct", factType: "FINANCIAL_ANALYSIS", factKey: "OCCUPANCY_PCT", ownerType: "DEAL" }),
    inPlaceRent: bindFact({ memoField: "property.inPlaceRent", factType: "FINANCIAL_ANALYSIS", factKey: "IN_PLACE_RENT_MO", ownerType: "DEAL" }),
  };

  // 5. Discover sponsors (distinct owner_entity_ids from PERSONAL facts)
  const sponsorIds = new Set<string>();
  for (const f of facts) {
    if (f.owner_type === "PERSONAL" && f.owner_entity_id) {
      sponsorIds.add(f.owner_entity_id);
    }
  }

  // Load sponsor names from deal_guarantors if available
  const sponsorNames = new Map<string, string | null>();
  if (sponsorIds.size > 0) {
    const { data: guarantorRows } = await (sb as any)
      .from("deal_guarantors")
      .select("id, name, display_name")
      .eq("deal_id", dealId)
      .in("id", Array.from(sponsorIds));

    for (const g of guarantorRows ?? []) {
      sponsorNames.set(String(g.id), g.display_name ?? g.name ?? null);
    }
  }

  const sponsors: SponsorBinding[] = [];
  for (const oid of sponsorIds) {
    const prefix = `sponsors[${sponsors.length}]`;
    sponsors.push({
      ownerEntityId: oid,
      name: sponsorNames.get(oid) ?? null,
      totalPersonalIncome: bindFact({ memoField: `${prefix}.totalPersonalIncome`, factType: "PERSONAL_INCOME", factKey: "TOTAL_PERSONAL_INCOME", ownerType: "PERSONAL", ownerEntityId: oid }),
      wagesW2: bindFact({ memoField: `${prefix}.wagesW2`, factType: "PERSONAL_INCOME", factKey: "WAGES_W2", ownerType: "PERSONAL", ownerEntityId: oid }),
      schedENet: bindFact({ memoField: `${prefix}.schedENet`, factType: "PERSONAL_INCOME", factKey: "SCHED_E_NET", ownerType: "PERSONAL", ownerEntityId: oid }),
      k1OrdinaryIncome: bindFact({ memoField: `${prefix}.k1OrdinaryIncome`, factType: "PERSONAL_INCOME", factKey: "K1_ORDINARY_INCOME", ownerType: "PERSONAL", ownerEntityId: oid }),
      totalAssets: bindFact({ memoField: `${prefix}.totalAssets`, factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_TOTAL_ASSETS", ownerType: "PERSONAL", ownerEntityId: oid }),
      totalLiabilities: bindFact({ memoField: `${prefix}.totalLiabilities`, factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_TOTAL_LIABILITIES", ownerType: "PERSONAL", ownerEntityId: oid }),
      netWorth: bindFact({ memoField: `${prefix}.netWorth`, factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_NET_WORTH", ownerType: "PERSONAL", ownerEntityId: oid }),
    });
  }

  // 6. Bind GLOBAL metrics (cross-entity GCF)
  const global = {
    globalCashFlow: bindFact({ memoField: "global.globalCashFlow", factType: "FINANCIAL_ANALYSIS", factKey: "GCF_GLOBAL_CASH_FLOW", ownerType: "DEAL" }),
    globalDscr: bindFact({ memoField: "global.globalDscr", factType: "FINANCIAL_ANALYSIS", factKey: "GCF_DSCR", ownerType: "DEAL" }),
    cashAvailable: null as number | null,
    personalDebtService: null as number | null,
    livingExpenses: null as number | null,
    totalObligations: null as number | null,
  };

  // GCF sub-metrics from GLOBAL_CASH_FLOW spread rows (stored as facts via spread pipeline)
  // These may not exist as explicit facts yet; bind what's available.
  // Sum personal debt service + living expenses across sponsors for the global section
  let totalPersonalDS = 0;
  let anyPersonalDS = false;
  let totalLiving = 0;
  let anyLiving = false;

  for (const oid of sponsorIds) {
    const ds = facts.find(
      (f) => f.owner_type === "PERSONAL" && f.owner_entity_id === oid &&
             f.fact_type === "PERSONAL_FINANCIAL_STATEMENT" && f.fact_key === "PFS_ANNUAL_DEBT_SERVICE",
    );
    if (ds?.fact_value_num != null) {
      totalPersonalDS += ds.fact_value_num;
      anyPersonalDS = true;
    }

    const lv = facts.find(
      (f) => f.owner_type === "PERSONAL" && f.owner_entity_id === oid &&
             f.fact_type === "PERSONAL_FINANCIAL_STATEMENT" && f.fact_key === "PFS_LIVING_EXPENSES",
    );
    if (lv?.fact_value_num != null) {
      totalLiving += lv.fact_value_num;
      anyLiving = true;
    }
  }

  if (anyPersonalDS) {
    global.personalDebtService = totalPersonalDS;
    provenance.push({
      memoField: "global.personalDebtService",
      factType: "PERSONAL_FINANCIAL_STATEMENT",
      factKey: "PFS_ANNUAL_DEBT_SERVICE",
      ownerType: "PERSONAL",
      source: "Computed:SUM(PFS_ANNUAL_DEBT_SERVICE)",
    });
  }

  if (anyLiving) {
    global.livingExpenses = totalLiving;
    provenance.push({
      memoField: "global.livingExpenses",
      factType: "PERSONAL_FINANCIAL_STATEMENT",
      factKey: "PFS_LIVING_EXPENSES",
      ownerType: "PERSONAL",
      source: "Computed:SUM(PFS_LIVING_EXPENSES)",
    });
  }

  if (anyPersonalDS || anyLiving) {
    global.totalObligations = (global.personalDebtService ?? 0) + (global.livingExpenses ?? 0);
    provenance.push({
      memoField: "global.totalObligations",
      ownerType: "GLOBAL",
      source: "Computed:PERSONAL_DS + LIVING_EXPENSES",
    });
  }

  // Cash available = sum of all sponsor income + property cash flow
  const totalSponsorIncome = sponsors.reduce(
    (sum, s) => sum + (s.totalPersonalIncome ?? 0),
    0,
  );
  const anySponsorIncome = sponsors.some((s) => s.totalPersonalIncome !== null);

  if (anySponsorIncome || property.cashFlowAvailable !== null) {
    global.cashAvailable = (anySponsorIncome ? totalSponsorIncome : 0) + (property.cashFlowAvailable ?? 0);
    provenance.push({
      memoField: "global.cashAvailable",
      ownerType: "GLOBAL",
      source: "Computed:PERSONAL_INCOME + PROPERTY_CASH_FLOW",
    });
  }

  // 7. Compute completeness
  const dealFields = Object.values(property);
  const personalFields = sponsors.flatMap((s) => [
    s.totalPersonalIncome, s.wagesW2, s.schedENet, s.k1OrdinaryIncome,
    s.totalAssets, s.totalLiabilities, s.netWorth,
  ]);
  const globalFields = [global.globalCashFlow, global.globalDscr, global.cashAvailable, global.personalDebtService, global.livingExpenses, global.totalObligations];

  function completenessStatus(fields: Array<number | null>): { total: number; populated: number; status: "complete" | "partial" | "empty" } {
    const total = fields.length;
    const populated = fields.filter((v) => v !== null).length;
    const status = populated === 0 ? "empty" : populated === total ? "complete" : "partial";
    return { total, populated, status };
  }

  return {
    dealId,
    bankId,
    generatedAt: new Date().toISOString(),
    periods: {
      fiscal: periods.fiscal,
      interim: periods.interim,
    },
    property,
    sponsors,
    global,
    completeness: {
      deal: completenessStatus(dealFields),
      personal: completenessStatus(personalFields),
      global: completenessStatus(globalFields),
    },
    provenance,
  };
}
