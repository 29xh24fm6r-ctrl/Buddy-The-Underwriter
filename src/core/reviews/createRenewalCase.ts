import "server-only";

/**
 * Phase 65J — Create Renewal Case
 *
 * One case per seeded renewal prep. Idempotent.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type CreateRenewalCaseInput = {
  dealId: string;
  bankId: string;
  renewalPrepId: string;
  targetMaturityDate: string;
  dueAt: string;
};

export type CreateCaseResult = {
  ok: boolean;
  caseId: string | null;
  created: boolean;
  error?: string;
};

export async function createRenewalCase(
  input: CreateRenewalCaseInput,
): Promise<CreateCaseResult> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("deal_renewal_cases")
    .select("id")
    .eq("renewal_prep_id", input.renewalPrepId)
    .maybeSingle();

  if (existing) {
    return { ok: true, caseId: existing.id, created: false };
  }

  const { data: row, error } = await sb
    .from("deal_renewal_cases")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      renewal_prep_id: input.renewalPrepId,
      target_maturity_date: input.targetMaturityDate,
      status: "seeded",
      readiness_state: "not_started",
      due_at: input.dueAt,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("deal_renewal_cases")
        .select("id")
        .eq("renewal_prep_id", input.renewalPrepId)
        .single();
      return { ok: true, caseId: raced?.id ?? null, created: false };
    }
    return { ok: false, caseId: null, created: false, error: error.message };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "renewal_case.created",
    title: "Renewal case created",
    detail: `Target maturity: ${input.targetMaturityDate.slice(0, 10)}`,
    visible_to_borrower: false,
  });

  return { ok: true, caseId: row.id, created: true };
}
