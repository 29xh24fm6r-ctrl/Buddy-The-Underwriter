import "server-only";

/**
 * Phase 65I — Generate Monitoring Cycles
 *
 * Creates due-date cycle instances from active obligations
 * within a 120-day lookahead window. Idempotent per obligation+due period.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateDueDatesInWindow } from "@/lib/post-close/computeNextDueDate";
import type { MonitoringCadence } from "./types";

const LOOKAHEAD_DAYS = 120;

export type GenerateCyclesInput = {
  dealId: string;
  bankId: string;
};

export type GenerateCyclesResult = {
  ok: boolean;
  generatedCount: number;
  skippedCount: number;
};

export async function generateMonitoringCycles(
  input: GenerateCyclesInput,
): Promise<GenerateCyclesResult> {
  const sb = supabaseAdmin();
  let generated = 0;
  let skipped = 0;

  // Get active obligations
  const { data: obligations } = await sb
    .from("deal_monitoring_obligations")
    .select("id, cadence, due_day, due_month, bank_id")
    .eq("deal_id", input.dealId)
    .eq("status", "active");

  if (!obligations || obligations.length === 0) {
    return { ok: true, generatedCount: 0, skippedCount: 0 };
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

  // Get existing cycles for dedup (by obligation_id + due_at date)
  const { data: existingCycles } = await sb
    .from("deal_monitoring_cycles")
    .select("obligation_id, due_at")
    .eq("deal_id", input.dealId);

  const existingKeys = new Set(
    (existingCycles ?? []).map(
      (c) => `${c.obligation_id}:${c.due_at.slice(0, 10)}`,
    ),
  );

  for (const ob of obligations) {
    const dueDates = generateDueDatesInWindow(
      ob.cadence as MonitoringCadence,
      now,
      windowEnd,
      ob.due_day,
      ob.due_month,
    );

    for (const dueDate of dueDates) {
      const dateKey = dueDate.toISOString().slice(0, 10);
      const key = `${ob.id}:${dateKey}`;

      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      const status = dueDate <= now ? "due" : "upcoming";

      const { error } = await sb.from("deal_monitoring_cycles").insert({
        obligation_id: ob.id,
        deal_id: input.dealId,
        bank_id: input.bankId,
        cycle_start_at: now.toISOString(),
        due_at: dueDate.toISOString(),
        status,
      });

      if (!error) {
        generated++;
        existingKeys.add(key); // Prevent intra-batch dupes
      }
    }
  }

  // Also mark overdue cycles
  await sb
    .from("deal_monitoring_cycles")
    .update({ status: "overdue" })
    .eq("deal_id", input.dealId)
    .eq("status", "due")
    .lt("due_at", now.toISOString());

  if (generated > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "monitoring_cycle.created",
      title: `${generated} monitoring cycle${generated > 1 ? "s" : ""} generated`,
      visible_to_borrower: false,
    });
  }

  return { ok: true, generatedCount: generated, skippedCount: skipped };
}
