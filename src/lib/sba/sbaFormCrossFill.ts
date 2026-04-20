// src/lib/sba/sbaFormCrossFill.ts
// Phase BPG — SBA form cross-fill from business plan data.
// Writes to existing sba_form_payloads (application_id + form_name UNIQUE).

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  SBAAssumptions,
  SourcesAndUsesResult,
  GuarantorCashFlow,
} from "./sbaReadinessTypes";

export interface CrossFillInput {
  dealId: string;
  assumptions: SBAAssumptions;
  sourcesAndUses?: SourcesAndUsesResult;
  guarantors?: GuarantorCashFlow[];
  // Optional borrower/business context
  dealName: string;
  naicsCode: string | null;
  ein: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface CrossFillResultEntry {
  form_name: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
}

export async function crossFillSBAForms(
  input: CrossFillInput,
): Promise<CrossFillResultEntry[]> {
  const sb = supabaseAdmin();

  // Resolve the borrower application id for this deal (sba_form_payloads.application_id
  // is the borrower_applications.id — not the deal_id).
  const { data: app } = await sb
    .from("borrower_applications")
    .select("id")
    .eq("deal_id", input.dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!app?.id) {
    return [
      {
        form_name: "*",
        status: "skipped",
        reason:
          "No borrower_applications row for this deal. Forms will cross-fill once an application exists.",
      },
    ];
  }

  const applicationId = app.id as string;
  const results: CrossFillResultEntry[] = [];

  // ── Form 1919 (Borrower Information) ──────────────────────────────────────
  const form1919Payload = {
    form_id: "SBA_1919",
    generated_at: new Date().toISOString(),
    source: "business_plan_cross_fill",
    borrower: {
      legal_name: input.dealName,
      ein: input.ein,
      naics: input.naicsCode,
      address_line1: input.addressLine1,
      city: input.city,
      state: input.state,
      zip: input.zip,
    },
    loan: {
      amount: input.assumptions.loanImpact.loanAmount,
      term_months: input.assumptions.loanImpact.termMonths,
      interest_rate: input.assumptions.loanImpact.interestRate,
    },
    equity_injection: {
      amount: input.assumptions.loanImpact.equityInjectionAmount ?? 0,
      source: input.assumptions.loanImpact.equityInjectionSource ?? "cash_savings",
    },
    seller_financing: {
      amount: input.assumptions.loanImpact.sellerFinancingAmount ?? 0,
      term_months: input.assumptions.loanImpact.sellerFinancingTermMonths ?? 0,
      rate: input.assumptions.loanImpact.sellerFinancingRate ?? 0,
    },
    management_team: (input.assumptions.managementTeam ?? []).map((m) => ({
      name: m.name,
      title: m.title,
      ownership_pct: m.ownershipPct ?? 0,
      years_in_industry: m.yearsInIndustry,
    })),
  };

  const form1919Res = await sb.from("sba_form_payloads").upsert(
    {
      application_id: applicationId,
      form_name: "SBA_1919",
      payload: form1919Payload,
      validation_errors: [],
      status: "complete",
    },
    { onConflict: "application_id,form_name" },
  );
  results.push({
    form_name: "SBA_1919",
    status: form1919Res.error ? "error" : "ok",
    reason: form1919Res.error?.message,
  });

  // ── Form 413 (Personal Financial Statement) — one per guarantor ───────────
  for (const g of input.guarantors ?? []) {
    const form413Payload = {
      form_id: "SBA_413",
      generated_at: new Date().toISOString(),
      source: "business_plan_cross_fill",
      guarantor: {
        entity_id: g.entityId,
        name: g.name,
        ownership_pct: g.ownershipPct,
      },
      income: {
        w2_salary: g.w2Salary,
        other: g.otherPersonalIncome,
      },
      obligations: {
        mortgage_payment: g.mortgagePayment,
        auto_payments: g.autoPayments,
        student_loans: g.studentLoans,
        credit_card_minimums: g.creditCardMinimums,
        other: g.otherPersonalDebt,
      },
    };
    const formName = `SBA_413_${g.entityId}`;
    const res = await sb.from("sba_form_payloads").upsert(
      {
        application_id: applicationId,
        form_name: formName,
        payload: form413Payload,
        validation_errors: [],
        status: "complete",
      },
      { onConflict: "application_id,form_name" },
    );
    results.push({
      form_name: formName,
      status: res.error ? "error" : "ok",
      reason: res.error?.message,
    });
  }

  // ── Sources & Uses schedule ────────────────────────────────────────────────
  if (input.sourcesAndUses) {
    const suPayload = {
      form_id: "SBA_SOURCES_AND_USES",
      generated_at: new Date().toISOString(),
      source: "business_plan_cross_fill",
      sources: input.sourcesAndUses.sources,
      uses: input.sourcesAndUses.uses,
      total_sources: input.sourcesAndUses.totalSources,
      total_uses: input.sourcesAndUses.totalUses,
      balanced: input.sourcesAndUses.balanced,
      equity_injection: input.sourcesAndUses.equityInjection,
    };
    const res = await sb.from("sba_form_payloads").upsert(
      {
        application_id: applicationId,
        form_name: "SBA_SOURCES_AND_USES",
        payload: suPayload,
        validation_errors: [],
        status: "complete",
      },
      { onConflict: "application_id,form_name" },
    );
    results.push({
      form_name: "SBA_SOURCES_AND_USES",
      status: res.error ? "error" : "ok",
      reason: res.error?.message,
    });
  }

  return results;
}
