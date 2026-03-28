import "server-only";

/**
 * Phase 65I — Seed Monitoring Obligations
 *
 * Seeds obligations from existing deal_covenants, deal_reporting_requirements,
 * and deal_monitoring_seeds. Idempotent — skips already-seeded source records.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  REPORTING_REQUIREMENT_MAP,
  mapTestingFrequencyToCadence,
} from "./monitoringCatalog";
import type { MonitoringObligationType, MonitoringCadence } from "./types";

export type SeedObligationsInput = {
  dealId: string;
  bankId: string;
  programId: string;
};

export type SeedObligationsResult = {
  ok: boolean;
  seededCount: number;
  skippedCount: number;
  error?: string;
};

export async function seedMonitoringObligations(
  input: SeedObligationsInput,
): Promise<SeedObligationsResult> {
  const sb = supabaseAdmin();
  let seeded = 0;
  let skipped = 0;

  // Get existing obligations for dedup
  const { data: existingObs } = await sb
    .from("deal_monitoring_obligations")
    .select("source, source_record_id")
    .eq("deal_id", input.dealId);

  const seededIds = new Set(
    (existingObs ?? [])
      .filter((o) => o.source_record_id)
      .map((o) => `${o.source}:${o.source_record_id}`),
  );

  // 1. Seed from deal_reporting_requirements
  const { data: reportingReqs } = await sb
    .from("deal_reporting_requirements")
    .select("id, requirement, frequency, status")
    .eq("deal_id", input.dealId)
    .in("status", ["approved", "active"]);

  for (const req of reportingReqs ?? []) {
    const key = `reporting_requirement:${req.id}`;
    if (seededIds.has(key)) {
      skipped++;
      continue;
    }

    const reqLower = (req.requirement ?? "").toLowerCase().trim();
    const mapping = findReportingMapping(reqLower);

    const cadence = mapFrequencyToCadence(req.frequency);

    const { error } = await sb.from("deal_monitoring_obligations").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      program_id: input.programId,
      obligation_type: mapping?.type ?? "custom",
      title: req.requirement,
      description: `Reporting requirement: ${req.requirement}`,
      cadence,
      requires_borrower_submission: true,
      requires_banker_review: true,
      is_financial_reporting: mapping?.isFinancialReporting ?? false,
      is_covenant_related: mapping?.isCovenantRelated ?? false,
      is_annual_review_input: mapping?.isAnnualReviewInput ?? false,
      is_renewal_related: false,
      status: "active",
      source: "reporting_requirement",
      source_record_id: req.id,
    });

    if (!error) seeded++;
  }

  // 2. Seed from deal_covenants
  const { data: covenants } = await sb
    .from("deal_covenants")
    .select("id, metric, threshold, testing_frequency, status")
    .eq("deal_id", input.dealId)
    .in("status", ["approved", "active"]);

  for (const cov of covenants ?? []) {
    const key = `covenant:${cov.id}`;
    if (seededIds.has(key)) {
      skipped++;
      continue;
    }

    const cadence = mapTestingFrequencyToCadence(cov.testing_frequency);

    const { error } = await sb.from("deal_monitoring_obligations").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      program_id: input.programId,
      obligation_type: "covenant_certificate",
      title: `Covenant: ${cov.metric} ${cov.threshold}`,
      description: `Covenant compliance certificate for ${cov.metric} (${cov.threshold}), tested ${cov.testing_frequency}.`,
      cadence,
      requires_borrower_submission: true,
      requires_banker_review: true,
      is_financial_reporting: false,
      is_covenant_related: true,
      is_annual_review_input: false,
      is_renewal_related: false,
      status: "active",
      source: "covenant",
      source_record_id: cov.id,
    });

    if (!error) seeded++;
  }

  // 3. Seed from deal_monitoring_seeds
  const { data: seeds } = await sb
    .from("deal_monitoring_seeds")
    .select("id, type, description, status")
    .eq("deal_id", input.dealId)
    .in("status", ["seeded", "activated"]);

  for (const seed of seeds ?? []) {
    const key = `monitoring_seed:${seed.id}`;
    if (seededIds.has(key)) {
      skipped++;
      continue;
    }

    const { error } = await sb.from("deal_monitoring_obligations").insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      program_id: input.programId,
      obligation_type: "custom",
      title: seed.type,
      description: seed.description,
      cadence: "annual",
      requires_borrower_submission: true,
      requires_banker_review: true,
      is_financial_reporting: false,
      is_covenant_related: false,
      is_annual_review_input: false,
      is_renewal_related: false,
      status: "active",
      source: "monitoring_seed",
      source_record_id: seed.id,
    });

    if (!error) seeded++;

    // Mark seed as activated
    await sb
      .from("deal_monitoring_seeds")
      .update({ status: "activated" })
      .eq("id", seed.id)
      ;
  }

  // Write timeline event if any seeded
  if (seeded > 0) {
    await sb.from("deal_timeline_events").insert({
      deal_id: input.dealId,
      kind: "monitoring_obligation.seeded",
      title: `${seeded} monitoring obligation${seeded > 1 ? "s" : ""} activated`,
      detail: `Seeded from covenants, reporting requirements, and monitoring seeds.`,
      visible_to_borrower: false,
    });
  }

  return { ok: true, seededCount: seeded, skippedCount: skipped };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findReportingMapping(reqText: string) {
  for (const [key, mapping] of Object.entries(REPORTING_REQUIREMENT_MAP)) {
    if (reqText.includes(key)) return mapping;
  }
  return null;
}

function mapFrequencyToCadence(freq: string): MonitoringCadence {
  switch (freq) {
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "annually":
      return "annual";
    case "ad_hoc":
      return "one_time";
    default:
      return "annual";
  }
}
