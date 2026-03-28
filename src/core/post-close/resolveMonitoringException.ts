import "server-only";

/**
 * Phase 65I — Resolve Monitoring Exception
 *
 * Explicit and auditable resolution.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ResolveExceptionInput = {
  exceptionId: string;
  dealId: string;
  resolvedBy: string;
  resolutionNote?: string;
  newStatus?: "resolved" | "waived" | "acknowledged";
};

export type ResolveExceptionResult = {
  ok: boolean;
  error?: string;
};

export async function resolveMonitoringException(
  input: ResolveExceptionInput,
): Promise<ResolveExceptionResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const status = input.newStatus ?? "resolved";

  const { error } = await sb
    .from("deal_monitoring_exceptions")
    .update({
      status,
      resolved_at: now,
      resolution_note: input.resolutionNote ?? null,
    })
    .eq("id", input.exceptionId)
    .in("status", ["open", "acknowledged"]);

  if (error) {
    return { ok: false, error: error.message };
  }

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "monitoring_exception.resolved",
    title: `Monitoring exception ${status}`,
    detail: input.resolutionNote ?? undefined,
    visible_to_borrower: false,
    meta: { exception_id: input.exceptionId, resolved_by: input.resolvedBy },
  });

  return { ok: true };
}
