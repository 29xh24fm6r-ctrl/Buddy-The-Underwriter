import "server-only";

/**
 * propagateConciergeFacts — the bridge between the borrower conversation
 * and the scoring/packaging engine.
 *
 * The concierge stores everything it learns in JSONB on
 * borrower_concierge_sessions. Nothing downstream reads that JSONB:
 * the Buddy SBA Score loads from deal_financial_facts and
 * borrower_applications, and the deal record itself drives matching.
 * This module writes confirmed/extracted facts through to the canonical
 * tables so the rest of the platform can see what the borrower said.
 *
 * Write targets (all verified against the live schema):
 *   deals                 — loan_amount, loan_type, state
 *   borrower_applications — business_legal_name, naics, industry,
 *                           loan_amount, loan_purpose, loan_type
 *                           (upsert on deal_id; unique index
 *                           borrower_applications_deal_id_key)
 *   deal_financial_facts  — YEARS_IN_BUSINESS / ANNUAL_REVENUE /
 *                           EMPLOYEE_COUNT, the exact fact keys
 *                           score/inputs.ts reads. Columns are
 *                           fact_value_num (NOT value_numeric);
 *                           bank_id + fact_type are NOT NULL.
 *
 * Concierge-sourced facts use fact_type "concierge". Document-extracted
 * facts always win: if a non-concierge row already exists for a key,
 * this module leaves it alone. Re-runs update the concierge row in
 * place rather than duplicating it.
 *
 * Every write is independent and non-fatal — a failure is reported in
 * the result, never thrown, so the conversation never breaks because a
 * write-through failed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ConciergeFacts = {
  borrower?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  business?: {
    legal_name?: string | null;
    industry_description?: string | null;
    naics?: string | null;
    is_startup?: boolean | null;
    years_in_business?: number | null;
    annual_revenue?: number | null;
    employee_count?: number | null;
    state?: string | null;
    is_franchise?: boolean | null;
    franchise_brand?: string | null;
  } | null;
  loan?: {
    amount_requested?: number | null;
    use_of_proceeds?: string | null;
  } | null;
};

export type PropagationResult = {
  ok: boolean;
  wrote: string[];
  skipped: string[];
  errors: string[];
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export async function propagateConciergeFacts(params: {
  dealId: string;
  bankId: string;
  facts: ConciergeFacts;
  sb: SupabaseClient;
}): Promise<PropagationResult> {
  const { dealId, bankId, facts, sb } = params;
  const wrote: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const loanAmount = num(facts?.loan?.amount_requested);
  const useOfProceeds = str(facts?.loan?.use_of_proceeds);
  const legalName = str(facts?.business?.legal_name);
  const naics = str(facts?.business?.naics);
  const industry = str(facts?.business?.industry_description);
  const state = str(facts?.business?.state);

  // ── 1. deals — loan_amount / loan_type / state ───────────────────────
  try {
    const { data: deal } = await sb
      .from("deals")
      .select("loan_amount, loan_type, state")
      .eq("id", dealId)
      .maybeSingle();

    const patch: Record<string, unknown> = {};
    if (loanAmount != null && deal?.loan_amount == null) {
      patch.loan_amount = loanAmount;
    }
    if (deal && deal.loan_type == null) patch.loan_type = "7a";
    if (state && deal?.state == null) patch.state = state;

    if (Object.keys(patch).length > 0) {
      const { error } = await sb.from("deals").update(patch).eq("id", dealId);
      if (error) errors.push(`deals: ${error.message}`);
      else wrote.push(`deals(${Object.keys(patch).join(",")})`);
    } else {
      skipped.push("deals");
    }
  } catch (e) {
    errors.push(`deals: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 2. borrower_applications — upsert on deal_id ─────────────────────
  // Requires the borrower_applications_deal_id_key unique index.
  try {
    const app: Record<string, unknown> = { deal_id: dealId };
    if (legalName) app.business_legal_name = legalName;
    if (naics) app.naics = naics;
    if (industry) app.industry = industry;
    if (loanAmount != null) app.loan_amount = loanAmount;
    if (useOfProceeds) app.loan_purpose = useOfProceeds;
    app.loan_type = "7a";

    if (Object.keys(app).length > 2) {
      const { error } = await sb
        .from("borrower_applications")
        .upsert(app, { onConflict: "deal_id" });
      if (error) errors.push(`borrower_applications: ${error.message}`);
      else wrote.push("borrower_applications");
    } else {
      skipped.push("borrower_applications");
    }
  } catch (e) {
    errors.push(
      `borrower_applications: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // ── 3. deal_financial_facts — the keys the score engine reads ────────
  const factWrites: Array<{ key: string; value: number | null }> = [
    { key: "YEARS_IN_BUSINESS", value: num(facts?.business?.years_in_business) },
    { key: "ANNUAL_REVENUE", value: num(facts?.business?.annual_revenue) },
    { key: "EMPLOYEE_COUNT", value: num(facts?.business?.employee_count) },
  ];

  for (const f of factWrites) {
    if (f.value == null) continue;
    try {
      const { data: existing } = await sb
        .from("deal_financial_facts")
        .select("id, fact_type, fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", f.key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && existing.fact_type !== "concierge") {
        // A document-extracted (or otherwise authoritative) fact already
        // exists for this key. Conversation never overrides documents.
        skipped.push(`fact:${f.key} (document fact present)`);
        continue;
      }

      if (existing && existing.fact_type === "concierge") {
        if (Number(existing.fact_value_num) === f.value) {
          skipped.push(`fact:${f.key} (unchanged)`);
          continue;
        }
        const { error } = await sb
          .from("deal_financial_facts")
          .update({
            fact_value_num: f.value,
            provenance: { source: "concierge", updated: true },
          })
          .eq("id", existing.id);
        if (error) errors.push(`fact:${f.key}: ${error.message}`);
        else wrote.push(`fact:${f.key}`);
        continue;
      }

      const { error } = await sb.from("deal_financial_facts").insert({
        deal_id: dealId,
        bank_id: bankId,
        fact_type: "concierge",
        fact_key: f.key,
        fact_value_num: f.value,
        confidence: 0.7,
        provenance: { source: "concierge" },
      });
      if (error) errors.push(`fact:${f.key}: ${error.message}`);
      else wrote.push(`fact:${f.key}`);
    } catch (e) {
      errors.push(
        `fact:${f.key}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { ok: errors.length === 0, wrote, skipped, errors };
}
