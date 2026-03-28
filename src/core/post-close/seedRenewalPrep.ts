import "server-only";

/**
 * Phase 65I — Seed Renewal Prep
 *
 * Seeds renewal prep when loan maturity enters 120-day prep window.
 * Idempotent per deal + maturity date.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

const RENEWAL_PREP_LOOKAHEAD_DAYS = 120;

export type SeedRenewalPrepInput = {
  dealId: string;
  bankId: string;
  maturityDate: string | null;
};

export type SeedRenewalPrepResult = {
  ok: boolean;
  prepId: string | null;
  created: boolean;
};

export async function seedRenewalPrep(
  input: SeedRenewalPrepInput,
): Promise<SeedRenewalPrepResult> {
  if (!input.maturityDate) {
    return { ok: true, prepId: null, created: false };
  }

  const maturity = new Date(input.maturityDate);
  const now = new Date();
  const daysUntilMaturity = Math.floor(
    (maturity.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  // Only seed within prep window
  if (daysUntilMaturity > RENEWAL_PREP_LOOKAHEAD_DAYS || daysUntilMaturity < 0) {
    return { ok: true, prepId: null, created: false };
  }

  const sb = supabaseAdmin();
  const maturityIso = maturity.toISOString();

  // Check existing
  const { data: existing } = await sb
    .from("deal_renewal_prep")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("target_maturity_date", maturityIso)
    .maybeSingle();

  if (existing) {
    return { ok: true, prepId: existing.id, created: false };
  }

  const prepStartAt = new Date(
    maturity.getTime() - RENEWAL_PREP_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
  );

  const { data: prep, error } = await sb
    .from("deal_renewal_prep")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      target_maturity_date: maturityIso,
      prep_start_at: prepStartAt.toISOString(),
      status: "seeded",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("deal_renewal_prep")
        .select("id")
        .eq("deal_id", input.dealId)
        .eq("target_maturity_date", maturityIso)
        .single();
      return { ok: true, prepId: raced?.id ?? null, created: false };
    }
    return { ok: false, prepId: null, created: false };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "renewal_prep.seeded",
    title: "Renewal prep initiated",
    detail: `Maturity: ${maturityIso.slice(0, 10)}`,
    visible_to_borrower: false,
  });

  return { ok: true, prepId: prep.id, created: true };
}
