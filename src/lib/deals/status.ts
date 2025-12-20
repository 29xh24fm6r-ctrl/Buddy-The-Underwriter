// src/lib/deals/status.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export type DealStage =
  | "intake"
  | "docs_in_progress"
  | "analysis"
  | "underwriting"
  | "conditional_approval"
  | "closing"
  | "funded"
  | "declined";

export type DealStatusRow = {
  deal_id: string;
  stage: DealStage;
  eta_date: string | null; // YYYY-MM-DD
  eta_note: string | null;
  updated_by: string | null;
  updated_at: string;
};

type UpdateDealStatusInput = {
  dealId: string;
  stage?: DealStage;
  etaDate?: string | null; // YYYY-MM-DD or null
  etaNote?: string | null; // borrower-safe note
  actorUserId?: string | null;
};

function normalizeEtaDate(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  // naive validation; UI should send YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Invalid etaDate format. Expected YYYY-MM-DD.");
  return v;
}

export async function upsertDealStatusAndLog(input: UpdateDealStatusInput) {
  const sb = supabaseAdmin();

  const eta_date = normalizeEtaDate(input.etaDate);
  const stage = input.stage;
  const eta_note = input.etaNote ?? undefined;

  // Read current status (best effort)
  const { data: existing } = await sb
    .from("deal_status")
    .select("*")
    .eq("deal_id", input.dealId)
    .maybeSingle();

  // Upsert status
  const patch: Partial<DealStatusRow> & { deal_id: string } = {
    deal_id: input.dealId,
    ...(stage !== undefined ? { stage } : {}),
    ...(eta_date !== undefined ? { eta_date } : {}),
    ...(eta_note !== undefined ? { eta_note } : {}),
    ...(input.actorUserId !== undefined ? { updated_by: input.actorUserId } : {}),
  };

  const { data: saved, error: upsertErr } = await sb
    .from("deal_status")
    .upsert(patch, { onConflict: "deal_id" })
    .select("*")
    .single();

  if (upsertErr) throw upsertErr;

  // Write timeline events (only for changed fields)
  const events: Array<{
    deal_id: string;
    kind: string;
    title: string;
    detail?: string | null;
    visible_to_borrower: boolean;
    created_by?: string | null;
  }> = [];

  if (stage !== undefined && existing?.stage !== stage) {
    events.push({
      deal_id: input.dealId,
      kind: "stage_changed",
      title: "Stage updated",
      detail: `Stage set to ${stage.replaceAll("_", " ")}`,
      visible_to_borrower: true,
      created_by: input.actorUserId ?? null,
    });
  }

  if (eta_date !== undefined && (existing?.eta_date ?? null) !== (eta_date ?? null)) {
    events.push({
      deal_id: input.dealId,
      kind: "eta_changed",
      title: "ETA updated",
      detail: eta_date ? `ETA set to ${eta_date}` : "ETA cleared",
      visible_to_borrower: true,
      created_by: input.actorUserId ?? null,
    });
  }

  if (eta_note !== undefined && (existing?.eta_note ?? null) !== (eta_note ?? null)) {
    // Borrower-safe note changes should still be visible
    events.push({
      deal_id: input.dealId,
      kind: "eta_note_changed",
      title: "Timeline note updated",
      detail: eta_note ? eta_note : "Note cleared",
      visible_to_borrower: true,
      created_by: input.actorUserId ?? null,
    });
  }

  if (events.length) {
    const { error: evErr } = await sb.from("deal_timeline_events").insert(events);
    if (evErr) throw evErr;
  }

  return saved as DealStatusRow;
}
