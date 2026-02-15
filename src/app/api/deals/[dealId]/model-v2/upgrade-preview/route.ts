/**
 * Phase 13 — Upgrade Preview Endpoint
 *
 * GET /api/deals/[dealId]/model-v2/upgrade-preview?targetVersion=<versionId>
 *
 * Read-only: computes what would change if the deal's registry version
 * were upgraded to a target version. No snapshot writes.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildFinancialModel } from "@/lib/modelEngine/buildFinancialModel";
import { extractBaseValues } from "@/lib/modelEngine/extractBaseValues";
import { evaluateMetricGraph } from "@/lib/modelEngine/metricGraph";
import { resolveRegistryBinding, loadVersionById } from "@/lib/metrics/registry/selectActiveVersion";
import { loadMetricDefsForVersion } from "@/lib/metrics/registry/loadMetricDefs";
import { compareSnapshotMetrics } from "@/lib/modelEngine/snapshot/compareSnapshots";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
import type { FinancialFact } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401
      : access.error === "tenant_mismatch" ? 403 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const { bankId } = access;
  const sb = supabaseAdmin();

  // 1. Validate target version param
  const url = new URL(req.url);
  const targetVersionId = url.searchParams.get("targetVersion");
  if (!targetVersionId) {
    return NextResponse.json(
      { ok: false, error: "targetVersion query param required" },
      { status: 400 },
    );
  }

  const targetVersion = await loadVersionById(sb, targetVersionId);
  if (!targetVersion) {
    return NextResponse.json(
      { ok: false, error: "target_version_not_found" },
      { status: 404 },
    );
  }
  if (targetVersion.status === "draft") {
    return NextResponse.json(
      { ok: false, error: "cannot_preview_draft_version" },
      { status: 409 },
    );
  }

  // 2. Resolve current binding (bank-aware)
  const currentBinding = await resolveRegistryBinding(sb, bankId);
  if (!currentBinding) {
    return NextResponse.json(
      { ok: false, error: "no_current_binding", detail: "No published registry version found" },
      { status: 404 },
    );
  }

  // 3. Early exit if already on target
  if (currentBinding.registryVersionId === targetVersionId) {
    return NextResponse.json({
      ok: true,
      alreadyOnTarget: true,
      currentVersion: currentBinding.registryVersionName,
      targetVersion: targetVersion.versionName,
    });
  }

  // 4. Load facts → build model → extract base values
  const { data: rawFacts, error: factsErr } = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .neq("fact_type", "EXTRACTION_HEARTBEAT");

  if (factsErr) {
    return NextResponse.json(
      { ok: false, error: "facts_load_failed", detail: factsErr.message },
      { status: 500 },
    );
  }

  const facts = (rawFacts ?? []) as FinancialFact[];
  const financialModel = buildFinancialModel(dealId, facts);
  const baseValues = extractBaseValues(financialModel);

  // 5. Evaluate with current + target metric defs
  const currentDefs = await loadMetricDefsForVersion(sb, currentBinding.registryVersionId);
  const targetDefs = await loadMetricDefsForVersion(sb, targetVersionId);

  const currentMetrics = evaluateMetricGraph(currentDefs, baseValues);
  const targetMetrics = evaluateMetricGraph(targetDefs, baseValues);

  // 6. Compare
  const comparison = compareSnapshotMetrics(currentMetrics, targetMetrics);

  // 7. Emit telemetry
  emitV2Event({
    code: V2_EVENT_CODES.METRIC_REGISTRY_UPGRADE_PREVIEW_RUN,
    dealId,
    bankId,
    payload: {
      currentVersion: currentBinding.registryVersionName,
      targetVersion: targetVersion.versionName,
      changed: comparison.summary.changed,
      added: comparison.summary.added,
      removed: comparison.summary.removed,
    },
  });

  return NextResponse.json({
    ok: true,
    currentVersion: currentBinding.registryVersionName,
    targetVersion: targetVersion.versionName,
    comparison: {
      deltas: comparison.deltas,
      summary: comparison.summary,
    },
  });
}
