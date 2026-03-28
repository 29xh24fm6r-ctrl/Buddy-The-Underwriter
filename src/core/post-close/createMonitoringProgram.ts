import "server-only";

/**
 * Phase 65I — Create Monitoring Program
 *
 * Seeds one monitoring program per closed/funded deal.
 * Idempotent — reuses existing program if present.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MonitoringProgramRow } from "./types";

export type CreateProgramInput = {
  dealId: string;
  bankId: string;
  loanClosedAt?: string | null;
  createdBy: string;
};

export type CreateProgramResult = {
  ok: boolean;
  programId: string | null;
  created: boolean;
  error?: string;
};

export async function createMonitoringProgram(
  input: CreateProgramInput,
): Promise<CreateProgramResult> {
  const sb = supabaseAdmin();

  // Idempotent: check for existing program
  const { data: existing } = await sb
    .from("deal_monitoring_programs")
    .select("id, status")
    .eq("deal_id", input.dealId)
    .maybeSingle();

  if (existing) {
    return { ok: true, programId: existing.id, created: false };
  }

  // Create program
  const { data: program, error } = await sb
    .from("deal_monitoring_programs")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      status: "active",
      loan_closed_at: input.loanClosedAt ?? null,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (error) {
    // Handle unique constraint (race condition)
    if (error.code === "23505") {
      const { data: raced } = await sb
        .from("deal_monitoring_programs")
        .select("id")
        .eq("deal_id", input.dealId)
        .single();
      return { ok: true, programId: raced?.id ?? null, created: false };
    }
    return { ok: false, programId: null, created: false, error: error.message };
  }

  // Write timeline event
  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "monitoring_program.created",
    title: "Monitoring program activated",
    detail: "Post-close monitoring obligations are now being tracked.",
    visible_to_borrower: false,
  });

  return { ok: true, programId: program.id, created: true };
}
