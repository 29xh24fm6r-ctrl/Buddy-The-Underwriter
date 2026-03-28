import "server-only";

/**
 * Phase 65I — Monitoring Program Summary Derivation
 *
 * Canonical summary for deal cockpit + command center.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MonitoringProgramSummary } from "./types";

export async function deriveMonitoringProgramSummary(
  dealId: string,
): Promise<MonitoringProgramSummary | null> {
  const sb = supabaseAdmin();

  // Get program
  const { data: program } = await sb
    .from("deal_monitoring_programs")
    .select("id, status, next_review_due_at, next_reporting_due_at, next_renewal_prep_at")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!program) return null;

  // Count cycles by status
  const [upcoming, due, overdue, underReview] = await Promise.all([
    sb
      .from("deal_monitoring_cycles")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "upcoming"),
    sb
      .from("deal_monitoring_cycles")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "due"),
    sb
      .from("deal_monitoring_cycles")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "overdue"),
    sb
      .from("deal_monitoring_cycles")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "under_review"),
  ]);

  // Count open exceptions
  const { count: openExceptions } = await sb
    .from("deal_monitoring_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("status", "open");

  return {
    dealId,
    programId: program.id,
    programStatus: program.status as MonitoringProgramSummary["programStatus"],
    upcomingCount: upcoming.count ?? 0,
    dueCount: due.count ?? 0,
    overdueCount: overdue.count ?? 0,
    underReviewCount: underReview.count ?? 0,
    openExceptionCount: openExceptions ?? 0,
    nextReviewDueAt: program.next_review_due_at,
    nextReportingDueAt: program.next_reporting_due_at,
    nextRenewalPrepAt: program.next_renewal_prep_at,
  };
}
