"use server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeEvent } from "@/lib/ledger/writeEvent";
import type { LoanRequest, LoanRequestInput, ProductTypeConfig } from "./types";

export async function createLoanRequest(
  dealId: string,
  input: LoanRequestInput,
  createdBy?: string | null,
  source: "banker" | "borrower_portal" | "api" = "banker",
  initialStatus: "draft" | "submitted" = "draft",
): Promise<{ ok: true; loanRequest: LoanRequest } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  let bankId: string | null = null;
  try {
    bankId = await getCurrentBankId();
  } catch {
    // Non-fatal — bank context may not be available (e.g. system source)
  }

  // Get next request_number for this deal
  const { data: existing } = await sb
    .from("deal_loan_requests")
    .select("request_number")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: false })
    .limit(1);

  const nextNumber = ((existing?.[0] as any)?.request_number ?? 0) + 1;

  const { data, error } = await sb
    .from("deal_loan_requests")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      request_number: nextNumber,
      product_type: input.product_type,
      requested_amount: input.requested_amount ?? null,
      loan_purpose: input.loan_purpose ?? null,
      purpose: input.loan_purpose ?? null,
      purpose_category: input.purpose_category ?? null,
      requested_term_months: input.requested_term_months ?? null,
      requested_amort_months: input.requested_amort_months ?? null,
      rate_type_preference: input.rate_type_preference ?? null,
      request_details: input.request_details ?? {},
      property_type: input.property_type ?? null,
      occupancy_type: input.occupancy_type ?? null,
      property_value: input.property_value ?? null,
      purchase_price: input.purchase_price ?? null,
      down_payment: input.down_payment ?? null,
      property_noi: input.property_noi ?? null,
      property_address_json: input.property_address_json ?? null,
      sba_program: input.sba_program ?? null,
      injection_amount: input.injection_amount ?? null,
      injection_source: input.injection_source ?? null,
      created_by: createdBy ?? null,
      source,
      status: initialStatus,
    } as any)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  await writeEvent({
    dealId,
    kind: "loan_request.created",
    actorUserId: createdBy ?? null,
    input: {
      loan_request_id: (data as any).id,
      product_type: input.product_type,
      requested_amount: input.requested_amount,
      request_number: nextNumber,
    },
  });

  return { ok: true, loanRequest: data as unknown as LoanRequest };
}

export async function updateLoanRequest(
  loanRequestId: string,
  updates: Partial<LoanRequestInput> & { status?: string },
  updatedBy?: string | null,
): Promise<{ ok: true; loanRequest: LoanRequest } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  // Keep purpose in sync with loan_purpose
  const patch: Record<string, unknown> = { ...updates };
  if (updates.loan_purpose !== undefined) {
    patch.purpose = updates.loan_purpose;
  }

  const { data, error } = await sb
    .from("deal_loan_requests")
    .update(patch as any)
    .eq("id", loanRequestId)
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed" };
  }

  await writeEvent({
    dealId: (data as any).deal_id,
    kind: "loan_request.updated",
    actorUserId: updatedBy ?? null,
    input: {
      loan_request_id: loanRequestId,
      updates: Object.keys(updates),
    },
  });

  return { ok: true, loanRequest: data as unknown as LoanRequest };
}

export async function deleteLoanRequest(
  loanRequestId: string,
  deletedBy?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("deal_loan_requests")
    .select("deal_id, request_number, product_type")
    .eq("id", loanRequestId)
    .single();

  if (!existing) {
    return { ok: false, error: "Loan request not found" };
  }

  const { error } = await sb
    .from("deal_loan_requests")
    .delete()
    .eq("id", loanRequestId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeEvent({
    dealId: (existing as any).deal_id,
    kind: "loan_request.deleted",
    actorUserId: deletedBy ?? null,
    input: {
      loan_request_id: loanRequestId,
      request_number: (existing as any).request_number,
      product_type: (existing as any).product_type,
    },
  });

  return { ok: true };
}

export async function getLoanRequestsForDeal(
  dealId: string,
): Promise<LoanRequest[]> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: true });

  if (error) {
    console.error("[getLoanRequestsForDeal]", error);
    return [];
  }

  return (data ?? []) as unknown as LoanRequest[];
}

export async function getLoanRequest(
  loanRequestId: string,
): Promise<LoanRequest | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("id", loanRequestId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as unknown as LoanRequest;
}

export async function getProductTypes(): Promise<ProductTypeConfig[]> {
  return getProductTypesForBank(null);
}

export async function getProductTypesForBank(
  bankId: string | null,
): Promise<ProductTypeConfig[]> {
  const sb = supabaseAdmin();

  // If bankId provided, check for bank-specific overrides
  if (bankId) {
    const { data: bankOverrides } = await sb
      .from("bank_loan_product_types")
      .select("product_code, display_name, sort_order")
      .eq("bank_id", bankId)
      .eq("enabled", true);

    if (bankOverrides && bankOverrides.length > 0) {
      // Bank has overrides — fetch only those product codes from the catalog
      const codes = bankOverrides.map((o: any) => o.product_code);
      const { data: products } = await sb
        .from("loan_product_types")
        .select("*")
        .in("code", codes)
        .eq("enabled", true)
        .order("display_order", { ascending: true });

      if (products && products.length > 0) {
        // Apply bank-specific display_name and sort_order overrides
        const overrideMap = new Map(
          bankOverrides.map((o: any) => [o.product_code, o]),
        );
        const result = (products as unknown as ProductTypeConfig[]).map((p) => {
          const ov = overrideMap.get(p.code) as any;
          return {
            ...p,
            label: ov?.display_name ?? p.label,
            display_order: ov?.sort_order ?? p.display_order,
          };
        });
        result.sort((a, b) => a.display_order - b.display_order);
        return result;
      }
    }
  }

  // Fall back to global enabled products
  const { data } = await sb
    .from("loan_product_types")
    .select("*")
    .eq("enabled", true)
    .order("display_order", { ascending: true });

  return (data ?? []) as unknown as ProductTypeConfig[];
}
