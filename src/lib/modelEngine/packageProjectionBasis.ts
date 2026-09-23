import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeAuthoritativeEngine } from "./engineAuthority";
import { loadPackageBusinessStage } from "./packageBusinessStage";
import { buildBaseYear, buildUseOfProceeds } from "@/lib/sba/sbaForwardModelBuilder";

/** One accepted business-history/opening/funding basis for package and interview. */
export async function loadPackageProjectionBasis(dealId: string, bankId: string) {
  const sb = supabaseAdmin();
  const { data: deal, error: dealError } = await sb.from("deals")
    .select("name, deal_type, loan_amount, city, state, bank_id").eq("id", dealId).eq("bank_id", bankId).single();
  if (dealError || !deal) throw new Error("Financial snapshot deal/bank mismatch");
  const authority = await computeAuthoritativeEngine(dealId, bankId, { persist: false });
  const periods = authority.financialModel.periods;
  const businessStage = await loadPackageBusinessStage(sb, dealId, bankId);
  const preOpening = businessStage === "pre_opening";
  const latest = [...periods].filter(p => p.type === "FYE").sort((a,b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  const revenue = latest?.income.revenue ?? 0;
  const cogs = latest?.income.cogs ?? 0;
  const opex = latest?.income.operatingExpenses ?? 0;
  const depreciation = latest?.income.depreciation ?? 0;
  const netIncome = latest?.income.netIncome ?? 0;
  const ebitda = latest?.cashflow.ebitda ?? 0;
  const ads = latest?.cashflow.annualDebtService ?? 0;
  // A startup's opening statement is usually interim, not a December FYE.
  const opening = preOpening
    ? [...periods].filter(p => p.balance.cash != null).sort((a,b) => b.periodEnd.localeCompare(a.periodEnd))[0]
    : latest;
  if (preOpening && periods.some(p => Object.values(p.income).some(v => typeof v === "number" && v !== 0))) {
    throw new Error("financial_input_required: your preparing-to-open answer conflicts with operating history. Review the business stage and financial documents.");
  }
  if (preOpening && (!opening || [opening.balance.cash, opening.balance.totalAssets,
    opening.balance.totalLiabilities, opening.balance.equity].some(v => v == null || !Number.isFinite(v)))) {
    throw new Error("financial_input_required: add an opening balance sheet with cash, total assets, total liabilities and equity before preparing a startup package.");
  }
  const bsBase = {
    cash: opening?.balance.cash ?? 0, accountsReceivable: opening?.balance.accountsReceivable ?? 0,
    inventory: opening?.balance.inventory ?? 0, fixedAssets: opening?.balance.netFixedAssets ?? 0,
    accountsPayable: opening?.balance.accountsPayable ?? 0, shortTermDebt: opening?.balance.shortTermDebt ?? 0,
    longTermDebt: opening?.balance.longTermDebt ?? 0, paidInCapital: (opening?.balance.paidInCapital ?? 0) + (opening?.balance.commonStock ?? 0),
    retainedEarnings: opening?.balance.retainedEarnings ?? ((opening?.balance.equity ?? 0) - (opening?.balance.paidInCapital ?? 0) - (opening?.balance.commonStock ?? 0)),
  };
  const baseYear = buildBaseYear({
    revenue,
    cogs,
    operatingExpenses: opex,
    ebitda,
    depreciation,
    netIncome,
    existingDebtServiceAnnual: ads,
  });
  if (preOpening) baseYear.label = "Pre-opening";

  const { data: proceedsItems, error: proceedsError } = await sb
    .from("deal_proceeds_items")
    .select("category, description, amount")
    .eq("deal_id", dealId);
  if (proceedsError) {
    throw new Error(`Use-of-proceeds load failed: ${proceedsError.message}`);
  }
  const useOfProceeds = buildUseOfProceeds(
    proceedsItems ?? [],
    Number(deal.loan_amount ?? 0),
  );

  return { deal, authority, periods, businessStage, preOpening, latest, opening, bsBase, baseYear, useOfProceeds };
}
