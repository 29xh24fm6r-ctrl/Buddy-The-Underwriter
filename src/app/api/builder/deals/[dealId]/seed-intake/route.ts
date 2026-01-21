import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { resolveBuilderBankId } from "@/lib/builder/resolveBuilderBankId";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { computeFinancialStress } from "@/lib/deals/financialStressEngine";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import {
  persistFinancialSnapshot,
  persistFinancialSnapshotDecision,
} from "@/lib/deals/financialSnapshotPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StepResult = {
  name: string;
  ok: boolean;
  status?: string;
  error?: string;
};

async function updateDealWithFallback(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  payload: Record<string, any>,
) {
  const attempt = await sb.from("deals").update(payload).eq("id", dealId);
  if (!attempt.error) return;

  const msg = String(attempt.error?.message ?? "");
  if (!msg.includes("column")) {
    throw attempt.error;
  }

  const fallbackPayload: Record<string, any> = {
    borrower_id: payload.borrower_id,
    borrower_name: payload.borrower_name,
    updated_at: payload.updated_at,
    name: payload.name,
    display_name: payload.display_name,
  };

  const fallback = await sb.from("deals").update(fallbackPayload).eq("id", dealId);
  if (fallback.error) throw fallback.error;
}

export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  mustBuilderToken(req);
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();
  const bankId = await resolveBuilderBankId(sb);

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, borrower_id, borrower_name, name, display_name")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) {
    return NextResponse.json(
      { ok: false, error: "db_error", message: dealErr.message },
      { status: 500 },
    );
  }

  if (!deal || String(deal.bank_id) !== String(bankId)) {
    return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  }

  const steps: StepResult[] = [];
  const now = new Date().toISOString();

  const step = async (name: string, fn: () => Promise<string | undefined>) => {
    try {
      const status = await fn();
      steps.push({ name, ok: true, status });
    } catch (error: any) {
      steps.push({ name, ok: false, error: String(error?.message ?? error) });
    }
  };

  await step("ensure_intake_initialized", async () => {
    await initializeIntake(dealId, bankId, { reason: "builder_seed_intake" });
    return undefined;
  });

  await step("ensure_borrower", async () => {
    if (deal.borrower_id) {
      return "already_attached";
    }

    const legalName =
      String(deal.display_name ?? deal.name ?? "Builder Seed Borrower").trim() ||
      "Builder Seed Borrower";

    const { data: borrower, error: borrowerErr } = await sb
      .from("borrowers")
      .insert({
        bank_id: bankId,
        legal_name: legalName,
        entity_type: "Unknown",
        primary_contact_name: "Builder Seed",
        primary_contact_email: `builder+${dealId.slice(0, 8)}@example.com`,
      })
      .select("id, legal_name")
      .single();

    if (borrowerErr || !borrower) {
      throw borrowerErr ?? new Error("borrower_insert_failed");
    }

    await updateDealWithFallback(sb, dealId, {
      borrower_id: borrower.id,
      borrower_name: borrower.legal_name ?? legalName,
      updated_at: now,
    });
  });

  await step("ensure_lifecycle_collecting", async () => {
    const res = await sb
      .from("deals")
      .update({ lifecycle_stage: "collecting", stage: "collecting", updated_at: now })
      .eq("id", dealId);

    if (!res.error) {
      return "set_collecting";
    }

    const msg = String(res.error?.message ?? "");
    if (msg.includes("lifecycle_stage")) {
      const stageOnly = await sb
        .from("deals")
        .update({ stage: "collecting", updated_at: now })
        .eq("id", dealId);

      if (!stageOnly.error) {
        return "set_collecting_stage_only";
      }

      return "column_missing";
    }

    if (msg.includes("stage")) {
      return "column_missing";
    }

    throw res.error;
  });

  await step("ensure_financial_snapshot", async () => {
    const { count } = await sb
      .from("financial_snapshot_decisions")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);

    if (count && count > 0) {
      return "already_present";
    }

    const snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
    const stress = computeFinancialStress({
      snapshot,
      loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: 7.5 },
      stress: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
    });
    const sba = evaluateSbaEligibility({
      snapshot,
      borrowerEntityType: "Unknown",
      useOfProceeds: ["working_capital"],
      dealType: null,
      loanProductType: "SBA7a",
    });
    const narrative = {
      executiveSummary: "Builder intake seed",
      cashFlowAnalysis: "Builder intake seed",
      risks: [],
      mitigants: [],
      recommendation: "Builder intake seed",
    };

    const snapRow = await persistFinancialSnapshot({
      dealId,
      bankId,
      snapshot,
      asOfTimestamp: now,
    });

    await persistFinancialSnapshotDecision({
      snapshotId: snapRow.id,
      dealId,
      bankId,
      inputs: {
        loanTerms: { principal: 1_000_000, amortMonths: 300, interestOnly: false, rate: 7.5 },
        loanProductType: "SBA7a",
        useOfProceeds: ["working_capital"],
        entityType: "Unknown",
        dealType: null,
      },
      stress,
      sba,
      narrative,
    });
  });

  return NextResponse.json({ ok: true, dealId, bankId, steps });
}
