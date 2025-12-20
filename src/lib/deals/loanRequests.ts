// src/lib/deals/loanRequests.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type LoanProductType =
  | "SBA_7A"
  | "SBA_504"
  | "CRE_TERM"
  | "C_AND_I_TERM"
  | "LINE_OF_CREDIT"
  | "EQUIPMENT"
  | "REFINANCE"
  | "OTHER";

export type DealLoanRequest = {
  id: string;
  deal_id: string;
  product_type: LoanProductType;

  requested_amount: number | null;
  requested_term_months: number | null;
  requested_amort_months: number | null;
  requested_rate_type: "FIXED" | "VARIABLE" | null;
  requested_rate_index: string | null;
  requested_spread_bps: number | null;
  requested_interest_only_months: number | null;

  purpose: string | null;
  use_of_proceeds: any | null;
  collateral_summary: string | null;
  guarantors_summary: string | null;
  notes: string | null;

  created_at: string;
  updated_at: string;
};

export type DealUnderwriteInput = {
  id: string;
  deal_id: string;
  proposed_product_type: LoanProductType;

  proposed_amount: number | null;
  proposed_term_months: number | null;
  proposed_amort_months: number | null;
  proposed_rate_type: "FIXED" | "VARIABLE" | null;
  proposed_rate_index: string | null;
  proposed_spread_bps: number | null;
  proposed_interest_only_months: number | null;

  guarantee_percent: number | null;
  ltv_target: number | null;
  dscr_target: number | null;
  global_dscr_target: number | null;
  pricing_floor_rate: number | null;

  covenants: any | null;
  exceptions: any | null;
  internal_notes: string | null;

  created_at: string;
  updated_at: string;
};

export async function listLoanRequests(dealId: string): Promise<DealLoanRequest[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DealLoanRequest[];
}

export async function upsertLoanRequest(input: Partial<DealLoanRequest> & { deal_id: string; product_type: LoanProductType }) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_loan_requests")
    .upsert(
      {
        id: (input as any).id ?? undefined,
        deal_id: input.deal_id,
        product_type: input.product_type,

        requested_amount: (input as any).requested_amount ?? null,
        requested_term_months: (input as any).requested_term_months ?? null,
        requested_amort_months: (input as any).requested_amort_months ?? null,
        requested_rate_type: (input as any).requested_rate_type ?? null,
        requested_rate_index: (input as any).requested_rate_index ?? null,
        requested_spread_bps: (input as any).requested_spread_bps ?? null,
        requested_interest_only_months: (input as any).requested_interest_only_months ?? null,

        purpose: (input as any).purpose ?? null,
        use_of_proceeds: (input as any).use_of_proceeds ?? null,
        collateral_summary: (input as any).collateral_summary ?? null,
        guarantors_summary: (input as any).guarantors_summary ?? null,
        notes: (input as any).notes ?? null,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as DealLoanRequest;
}

export async function listUnderwriteInputs(dealId: string): Promise<DealUnderwriteInput[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_underwrite_inputs")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DealUnderwriteInput[];
}

export async function upsertUnderwriteInput(
  input: Partial<DealUnderwriteInput> & { deal_id: string; proposed_product_type: LoanProductType }
) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_underwrite_inputs")
    .upsert(
      {
        id: (input as any).id ?? undefined,
        deal_id: input.deal_id,
        proposed_product_type: input.proposed_product_type,

        proposed_amount: (input as any).proposed_amount ?? null,
        proposed_term_months: (input as any).proposed_term_months ?? null,
        proposed_amort_months: (input as any).proposed_amort_months ?? null,
        proposed_rate_type: (input as any).proposed_rate_type ?? null,
        proposed_rate_index: (input as any).proposed_rate_index ?? null,
        proposed_spread_bps: (input as any).proposed_spread_bps ?? null,
        proposed_interest_only_months: (input as any).proposed_interest_only_months ?? null,

        guarantee_percent: (input as any).guarantee_percent ?? null,
        ltv_target: (input as any).ltv_target ?? null,
        dscr_target: (input as any).dscr_target ?? null,
        global_dscr_target: (input as any).global_dscr_target ?? null,
        pricing_floor_rate: (input as any).pricing_floor_rate ?? null,

        covenants: (input as any).covenants ?? null,
        exceptions: (input as any).exceptions ?? null,
        internal_notes: (input as any).internal_notes ?? null,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as DealUnderwriteInput;
}
