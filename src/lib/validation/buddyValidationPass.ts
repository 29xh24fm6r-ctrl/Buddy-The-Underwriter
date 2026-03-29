import "server-only";

/**
 * Phase 53 — Buddy Validation Pass Orchestrator
 *
 * Runs five validation families against snapshot facts.
 * Produces a gating decision for memo generation.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runMathematicalChecks } from "./mathematicalChecks";
import { runCompletenessChecks } from "./completenessChecks";
import { runPlausibilityChecks } from "./plausibilityChecks";
import type { ValidationReport, ValidationCheck } from "./validationTypes";
import crypto from "node:crypto";

export async function runBuddyValidationPass(
  dealId: string,
): Promise<ValidationReport> {
  const sb = supabaseAdmin();

  // Load current facts
  const { data: factsRows } = await sb
    .from("deal_financial_facts")
    .select("fact_key, value_num")
    .eq("deal_id", dealId)
    .eq("is_superseded", false);

  const factMap: Record<string, number | null> = {};
  for (const row of factsRows ?? []) {
    factMap[row.fact_key] = row.value_num ?? null;
  }

  // Compute snapshot hash for caching
  const snapshotHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(factMap, Object.keys(factMap).sort()))
    .digest("hex")
    .slice(0, 16);

  // Check cache
  const { data: cached } = await sb
    .from("buddy_validation_reports")
    .select("*")
    .eq("deal_id", dealId)
    .eq("snapshot_hash", snapshotHash)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached) {
    return {
      dealId,
      runAt: cached.run_at,
      overallStatus: cached.overall_status as ValidationReport["overallStatus"],
      gatingDecision: cached.gating_decision as ValidationReport["gatingDecision"],
      checks: cached.checks as ValidationCheck[],
      summary: cached.summary ?? "",
      flagCount: cached.flag_count,
      blockCount: cached.block_count,
      snapshotHash,
    };
  }

  // Determine deal type
  const { data: deal } = await sb
    .from("deals")
    .select("entity_type")
    .eq("id", dealId)
    .maybeSingle();

  const dealType = mapEntityType(deal?.entity_type);

  // Run all check families
  const checks: ValidationCheck[] = [
    ...runCompletenessChecks(factMap, dealType),
    ...runMathematicalChecks(factMap),
    ...runPlausibilityChecks(factMap),
  ];

  // Aggregate
  const blockCount = checks.filter((c) => c.status === "BLOCK").length;
  const flagCount = checks.filter((c) => c.status === "FLAG").length;

  const overallStatus: ValidationReport["overallStatus"] =
    blockCount > 0 ? "FAIL" : flagCount > 0 ? "PASS_WITH_FLAGS" : "PASS";

  const gatingDecision: ValidationReport["gatingDecision"] =
    blockCount > 0 ? "BLOCK_GENERATION" : "ALLOW_GENERATION";

  const summary = buildSummary(overallStatus, blockCount, flagCount, checks);

  const report: ValidationReport = {
    dealId,
    runAt: new Date().toISOString(),
    overallStatus,
    gatingDecision,
    checks,
    summary,
    flagCount,
    blockCount,
    snapshotHash,
  };

  // Persist
  await sb.from("buddy_validation_reports").insert({
    deal_id: dealId,
    run_at: report.runAt,
    overall_status: overallStatus,
    gating_decision: gatingDecision,
    flag_count: flagCount,
    block_count: blockCount,
    summary,
    checks: checks as any,
    snapshot_hash: snapshotHash,
  });

  return report;
}

function mapEntityType(
  entityType: string | null | undefined,
): "operating_company" | "real_estate" | "mixed" {
  if (!entityType) return "operating_company";
  const lower = (entityType ?? "").toLowerCase();
  if (lower.includes("real_estate") || lower.includes("cre")) return "real_estate";
  if (lower.includes("mixed")) return "mixed";
  return "operating_company";
}

function buildSummary(
  status: string,
  blockCount: number,
  flagCount: number,
  checks: ValidationCheck[],
): string {
  if (status === "PASS") {
    return "All validation checks passed. Data is internally consistent and complete. Generation is allowed.";
  }
  if (status === "PASS_WITH_FLAGS") {
    const flagNames = checks.filter((c) => c.status === "FLAG").map((c) => c.name);
    return `Validation passed with ${flagCount} flag(s): ${flagNames.join(", ")}. Generation is allowed but review the flagged items.`;
  }
  const blockNames = checks.filter((c) => c.status === "BLOCK").map((c) => c.name);
  return `Validation failed with ${blockCount} blocking error(s): ${blockNames.join(", ")}. Generation is blocked until these are resolved.`;
}
