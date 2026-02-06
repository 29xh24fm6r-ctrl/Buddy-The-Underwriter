import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { computeFinancialStress } from "@/lib/deals/financialStressEngine";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import {
  persistFinancialSnapshot,
  persistFinancialSnapshotDecision,
} from "@/lib/deals/financialSnapshotPersistence";

export type FinancialSnapshotResult =
  | { status: "already_present"; snapshotId?: string }
  | { status: "created"; snapshotId: string };

export async function buildFinancialSnapshot(args: {
  dealId: string;
  bankId: string;
  borrowerEntityType?: string | null;
}): Promise<FinancialSnapshotResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  const { count } = await sb
    .from("financial_snapshot_decisions")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId);

  if (count && count > 0) {
    return { status: "already_present" };
  }

  const snapshot = await buildDealFinancialSnapshotForBank({
    dealId: args.dealId,
    bankId: args.bankId,
  });

  // Prefer locked pricing quote rate over hardcoded fallback
  let stressRate = 7.5;
  try {
    const { data: lockedQuote } = await sb
      .from("deal_pricing_quotes")
      .select("all_in_rate_pct")
      .eq("deal_id", args.dealId)
      .eq("status", "locked")
      .order("locked_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (lockedQuote?.all_in_rate_pct != null) {
      stressRate = Number(lockedQuote.all_in_rate_pct);
    }
  } catch {
    // Non-fatal — fall back to default rate
  }

  const stress = computeFinancialStress({
    snapshot,
    loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: stressRate },
    stress: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
  });

  const sba = evaluateSbaEligibility({
    snapshot,
    borrowerEntityType: args.borrowerEntityType ?? "Unknown",
    useOfProceeds: ["working_capital"],
    dealType: null,
    loanProductType: "SBA7a",
  });

  const narrative = {
    executiveSummary: "Seed intake snapshot",
    cashFlowAnalysis: "Seed intake snapshot",
    risks: [],
    mitigants: [],
    recommendation: "Seed intake snapshot",
  };

  const snapRow = await persistFinancialSnapshot({
    dealId: args.dealId,
    bankId: args.bankId,
    snapshot,
    asOfTimestamp: now,
  });

  if (!snapRow?.id) {
    throw new Error("snapshot_missing");
  }

  await persistFinancialSnapshotDecision({
    snapshotId: snapRow.id,
    dealId: args.dealId,
    bankId: args.bankId,
    inputs: {
      snapshot,
      loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: stressRate },
      stressScenario: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
      sbaInputs: {
        borrowerEntityType: args.borrowerEntityType ?? "Unknown",
        useOfProceeds: ["working_capital"],
        dealType: null,
        loanProductType: "SBA7a",
      },
    },
    stress,
    sba,
    narrative,
  });

  return { status: "created", snapshotId: snapRow.id };
}
