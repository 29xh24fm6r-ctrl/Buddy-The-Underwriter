/**
 * Flag from Documents — structural and missing-document checks.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, SpreadFlag } from "./types";
import { buildFlag, toNum, fmtDollars, fmtPct } from "./flagHelpers";
import { getRule } from "./flagRegistry";
import { generateQuestion } from "./questionGenerator";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromDocuments(input: FlagEngineInput): SpreadFlag[] {
  const flags: SpreadFlag[] = [];
  const { canonical_facts: facts, deal_id, years_available, deal_type } = input;
  const latestYear = years_available.length > 0
    ? Math.max(...years_available)
    : undefined;

  // 1. Lease expiration before loan maturity
  const leaseExp = facts["lease_expiration_date"];
  const loanMat = facts["loan_maturity_date"];
  if (leaseExp && loanMat) {
    const leaseDate = new Date(String(leaseExp));
    const loanDate = new Date(String(loanMat));
    if (!isNaN(leaseDate.getTime()) && !isNaN(loanDate.getTime()) && leaseDate < loanDate) {
      flags.push(makeDocFlag(
        deal_id, "lease_expiring_within_loan_term", String(leaseExp), latestYear,
        `Primary lease expires (${String(leaseExp)}) before loan maturity (${String(loanMat)}).`,
        `The primary lease expires on ${String(leaseExp)}, which is before the proposed loan maturity date of ${String(loanMat)}. This creates occupancy and cash flow risk if the lease is not renewed.`,
        `Lease expiration before loan maturity is a material risk — the borrower's ability to service the loan depends on continued occupancy or a renewal option.`,
        facts,
      ));
    }
  }

  // 2. Customer concentration > 25%
  const custConc = toNum(facts["largest_customer_revenue_pct"]);
  if (custConc !== null && custConc > 0.25) {
    flags.push(makeDocFlag(
      deal_id, "customer_concentration_25pct", custConc, latestYear,
      `Largest customer represents ${fmtPct(custConc)} of revenue.`,
      `Revenue concentration: a single customer accounts for ${fmtPct(custConc)} of total revenue. Loss of this customer could materially impair cash flow and debt service coverage.`,
      `Customer concentration above 25% creates dependency risk. Evaluate the customer relationship, contract terms, and diversification strategy.`,
      facts,
    ));
  }

  // 3. Provider concentration > 80% (professional practices)
  const provConc = toNum(facts["largest_provider_revenue_pct"]);
  if (provConc !== null && provConc > 0.80) {
    flags.push(makeDocFlag(
      deal_id, "provider_concentration_80pct", provConc, latestYear,
      `Single provider generates ${fmtPct(provConc)} of revenue — key person risk.`,
      `Revenue is highly concentrated with a single practitioner/provider generating ${fmtPct(provConc)} of total revenue. This creates significant key-person dependency.`,
      `Key-person risk at this level should be mitigated through life insurance assignment, succession planning documentation, or associate development evidence.`,
      facts,
    ));
  }

  // 4. Undisclosed contingent liabilities
  const contingent = toNum(facts["pfs_contingent_liability_amount"]);
  if (contingent !== null && contingent > 0) {
    flags.push(makeDocFlag(
      deal_id, "undisclosed_contingent_liability", contingent, latestYear,
      `Contingent liabilities of ${fmtDollars(contingent)} identified on personal financial statement.`,
      `The personal financial statement lists contingent liabilities totaling ${fmtDollars(contingent)}. These obligations could become actual liabilities and impact the guarantor's ability to support the credit.`,
      `Contingent liabilities must be evaluated for probability of realization and potential impact on the guarantor's net worth and liquidity.`,
      facts,
    ));
  }

  // 5. Entity formed within 12 months
  const formDate = facts["entity_formation_date"];
  const appDate = facts["application_date"];
  if (formDate) {
    const formation = new Date(String(formDate));
    const application = appDate ? new Date(String(appDate)) : new Date();
    if (!isNaN(formation.getTime()) && !isNaN(application.getTime())) {
      const monthsDiff = (application.getFullYear() - formation.getFullYear()) * 12
        + (application.getMonth() - formation.getMonth());
      if (monthsDiff <= 12) {
        flags.push(makeDocFlag(
          deal_id, "entity_formed_within_12_months", String(formDate), latestYear,
          `Entity was formed within the last 12 months (${String(formDate)}).`,
          `The borrowing entity was formed on ${String(formDate)}, approximately ${monthsDiff} months before the application date. Start-up entities have limited operating history for credit analysis.`,
          `Entities with less than 12 months of operating history present higher risk due to unproven business models and limited financial track record.`,
          facts,
        ));
      }
    }
  }

  // 6. YTD financials stale (> 90 days)
  const ytdDate = facts["ytd_statement_date"];
  if (ytdDate) {
    const stmtDate = new Date(String(ytdDate));
    const today = new Date();
    if (!isNaN(stmtDate.getTime())) {
      const daysDiff = Math.floor((today.getTime() - stmtDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 90) {
        flags.push(makeDocFlag(
          deal_id, "ydt_financials_stale_90_days", String(ytdDate), latestYear,
          `YTD financials dated ${String(ytdDate)} are ${daysDiff} days old (exceeds 90-day limit).`,
          `The most recent year-to-date financial statements on file are dated ${String(ytdDate)}, which is ${daysDiff} days ago. Current financials are needed to assess the borrower's present financial condition.`,
          `Stale financials may mask deterioration in business performance that has occurred since the statement date.`,
          facts,
        ));
      }
    }
  }

  // 7. Schedule E missing (rental income present but no Schedule E)
  const rentalIncome = toNum(facts["SCH_E_RENTS_RECEIVED"]);
  const schEExtracted = facts["schedule_e_extracted"];
  if (rentalIncome !== null && rentalIncome > 0 && schEExtracted === false) {
    flags.push(makeDocFlag(
      deal_id, "schedule_e_missing", rentalIncome, latestYear,
      `Personal return shows rental income of ${fmtDollars(rentalIncome)} but Schedule E is missing.`,
      `The personal tax return indicates rental income of ${fmtDollars(rentalIncome)}, but Schedule E has not been provided or extracted. Schedule E is needed to analyze rental property income and expenses.`,
      `Without Schedule E, rental income cannot be properly analyzed for the global cash flow calculation.`,
      facts,
    ));
  }

  // 8. Personal financial statement stale
  const pfsDate = facts["pfs_date"];
  if (pfsDate) {
    const pfs = new Date(String(pfsDate));
    const today = new Date();
    if (!isNaN(pfs.getTime())) {
      const daysDiff = Math.floor((today.getTime() - pfs.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 90) {
        flags.push(makeDocFlag(
          deal_id, "personal_financial_statement_stale", String(pfsDate), latestYear,
          `Personal financial statement dated ${String(pfsDate)} is ${daysDiff} days old.`,
          `The personal financial statement on file is dated ${String(pfsDate)}, which is ${daysDiff} days old. A current PFS is required for guarantor analysis.`,
          `Guarantor's current financial position may differ materially from the stale PFS on file.`,
          facts,
        ));
      }
    }
  }

  // 9. Rent roll missing (CRE deals)
  const isDealCRE = deal_type === "CRE" || deal_type === "real_estate" || deal_type === "REAL_ESTATE";
  const rentRollPresent = facts["rent_roll_present"];
  if (isDealCRE && rentRollPresent === false) {
    flags.push(makeDocFlag(
      deal_id, "rent_roll_missing", null, latestYear,
      `Rent roll is missing for this real estate deal.`,
      `This is a real estate transaction but no rent roll has been provided. A current rent roll is required to validate property income and assess tenant quality and lease rollover risk.`,
      `Without a rent roll, property income cannot be properly underwritten and collateral analysis is incomplete.`,
      facts,
    ));
  }

  // 10. Construction budget missing
  const isConstruction = deal_type === "construction" || deal_type === "CONSTRUCTION" || deal_type === "renovation";
  const budgetPresent = facts["construction_budget_present"];
  if (isConstruction && budgetPresent === false) {
    flags.push(makeDocFlag(
      deal_id, "construction_budget_missing", null, latestYear,
      `Construction budget is missing for this construction/renovation loan.`,
      `This is a construction or renovation loan but no detailed construction budget has been provided. A budget is required for draw management, feasibility assessment, and contingency evaluation.`,
      `Construction loans cannot proceed without a budget — this is a blocking requirement.`,
      facts,
    ));
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeDocFlag(
  dealId: string,
  triggerType: string,
  observedValue: number | string | null,
  yearObserved: number | undefined,
  bankerSummary: string,
  bankerDetail: string,
  bankerImplication: string,
  facts: Record<string, unknown>,
): SpreadFlag {
  const rule = getRule(triggerType);
  const flag = buildFlag({
    dealId,
    triggerType,
    category: rule?.category ?? "missing_data",
    severity: rule?.default_severity ?? "elevated",
    canonicalKeys: rule?.canonical_keys_involved ?? [],
    observedValue,
    yearObserved,
    bankerSummary,
    bankerDetail,
    bankerImplication,
    borrowerQuestion: null,
  });

  if (rule?.generates_question) {
    flag.borrower_question = generateQuestion(flag, facts);
  }

  return flag;
}
