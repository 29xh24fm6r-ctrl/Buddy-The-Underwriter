import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { resolveBuilderBankId } from "@/lib/builder/resolveBuilderBankId";
import { makeBuilderDealReadyCore } from "@/lib/builder/builderDealsCore";
import { initializeIntake } from "@/lib/deals/intake/initializeIntake";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { computeFinancialStress } from "@/lib/deals/financialStressEngine";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import { persistFinancialSnapshot, persistFinancialSnapshotDecision } from "@/lib/deals/financialSnapshotPersistence";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function insertLockedQuote(args: { sb: ReturnType<typeof supabaseAdmin>; dealId: string; bankId: string }) {
  const now = new Date().toISOString();
  const payload: Record<string, any> = {
    bank_id: args.bankId,
    deal_id: args.dealId,
    created_at: now,
    index_code: "SOFR",
    base_rate_pct: 5,
    spread_bps: 250,
    all_in_rate_pct: 7.5,
    loan_amount: 1_000_000,
    term_months: 120,
    amort_months: 300,
    interest_only_months: 0,
    status: "locked",
    locked_at: now,
    locked_by: "builder",
    lock_reason: "builder_make_ready",
  };

  let res = await args.sb
    .from("deal_pricing_quotes")
    .insert(payload)
    .select("id")
    .single();

  if (!res.error) return;

  const msg = String(res.error.message || "");
  if (msg.includes("column") || msg.includes("locked_at") || msg.includes("status")) {
    const fallbackPayload: Record<string, any> = {
      bank_id: args.bankId,
      deal_id: args.dealId,
      created_at: now,
      index_code: "SOFR",
      base_rate_pct: 5,
      spread_bps: 250,
      all_in_rate_pct: 7.5,
      loan_amount: 1_000_000,
      term_months: 120,
      amort_months: 300,
      interest_only_months: 0,
    };
    res = await args.sb
      .from("deal_pricing_quotes")
      .insert(fallbackPayload)
      .select("id")
      .single();
  }

  if (res.error) throw res.error;
}

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
    name: payload.name,
    borrower_name: payload.borrower_name,
    borrower_id: payload.borrower_id,
    updated_at: payload.updated_at,
  };

  const fallback = await sb.from("deals").update(fallbackPayload).eq("id", dealId);
  if (fallback.error) throw fallback.error;
}

export async function POST(req: Request) {
  mustBuilderToken(req);
  const sb = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const dealId = String(body?.dealId ?? "").trim();

    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "missing_deal_id" },
        { status: 400 },
      );
    }

    const bankId = await resolveBuilderBankId(sb);

    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal || String(deal.bank_id) !== String(bankId)) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    const result = await makeBuilderDealReadyCore({
      dealId,
      bankId,
      now: () => new Date().toISOString(),
      randomUUID: () => randomUUID(),
      ops: {
        createDeal: async () => ({ id: dealId }),
        updateDeal: async (id, payload) => {
          await updateDealWithFallback(sb, id, payload);
        },
        ensureChecklist: async (id, bankIdArg) => {
          await initializeIntake(id, bankIdArg, { reason: "builder_make_ready" });
        },
        markChecklistReceived: async (id) => {
          await sb
            .from("deal_checklist_items")
            .update({ received_at: new Date().toISOString() })
            .eq("deal_id", id)
            .eq("required", true)
            .is("received_at", null);
        },
        ensureFinancialSnapshotDecision: async (id, bankIdArg) => {
          const snapshot = await buildDealFinancialSnapshotForBank({ dealId: id, bankId: bankIdArg });
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
            executiveSummary: "Builder narrative",
            cashFlowAnalysis: "Builder narrative",
            risks: [],
            mitigants: [],
            recommendation: "Builder narrative",
          };

          const snapRow = await persistFinancialSnapshot({
            dealId: id,
            bankId: bankIdArg,
            snapshot,
            asOfTimestamp: new Date().toISOString(),
          });

          await persistFinancialSnapshotDecision({
            snapshotId: snapRow.id,
            dealId: id,
            bankId: bankIdArg,
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
        },
        ensureLockedQuote: async (id, bankIdArg) => {
          await insertLockedQuote({ sb, dealId: id, bankId: bankIdArg });
        },
      },
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error: any) {
    console.error("[builder.deals.make-ready] failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unexpected_error" },
      { status: 500 },
    );
  }
}
