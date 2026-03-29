import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Get the canonical loan request for underwriting from deal_loan_requests.
 * This is the ONLY authoritative loan request source.
 *
 * Rules:
 * 1. Prefer latest non-draft request with requested_amount > 0
 * 2. Otherwise fall back to lowest request_number draft only for edit UX
 * 3. Underwriting launch requires a non-draft submitted request
 */
export async function getCanonicalLoanRequestForUnderwriting(
  dealId: string,
): Promise<{
  request: Record<string, unknown> | null;
  isSubmitted: boolean;
  requestId: string | null;
}> {
  const sb = supabaseAdmin();

  // Try canonical deal_loan_requests first (submitted, non-draft, has amount)
  const { data: submitted } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .gt("requested_amount", 0)
    .order("request_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (submitted) {
    return {
      request: submitted,
      isSubmitted: true,
      requestId: submitted.id,
    };
  }

  // Fall back to any draft request (for edit UX)
  const { data: draft } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .order("request_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (draft) {
    return {
      request: draft,
      isSubmitted: false,
      requestId: draft.id,
    };
  }

  // Also check Phase 55 loan_requests as fallback (non-canonical, for migration period)
  const { data: phase55Request } = await sb
    .from("loan_requests")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (phase55Request) {
    return {
      request: phase55Request,
      isSubmitted: !!(phase55Request.loan_amount && phase55Request.loan_purpose && phase55Request.loan_type),
      requestId: phase55Request.id,
    };
  }

  return { request: null, isSubmitted: false, requestId: null };
}
