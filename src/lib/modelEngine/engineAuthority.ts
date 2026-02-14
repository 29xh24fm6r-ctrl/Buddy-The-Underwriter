/**
 * Model Engine — Authoritative Engine Boundary
 *
 * Single authority layer for financial computation.
 * Only computeAuthoritativeEngine may persist snapshots or write to deal_spreads.
 * computeLegacyComparison is read-only — NO persistence, NO side effects.
 *
 * Routes are thin orchestrators that call these functions.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildFinancialModel } from "./buildFinancialModel";
import { evaluateMetricGraphWithAudit } from "./metricGraph";
import { loadMetricRegistry } from "./metricRegistryLoader";
import { renderFromFinancialModel } from "./renderer/v2Adapter";
import { persistModelV2SnapshotFromDeal } from "./services/persistModelV2SnapshotFromDeal";
import { emitV2Event, V2_EVENT_CODES } from "./events";
import { isShadowCompareEnabled } from "./modeSelector";
import { renderStandardSpreadWithValidation } from "@/lib/financialSpreads/standard/renderStandardSpread";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { resolveRegistryBinding } from "@/lib/metrics/registry/selectActiveVersion";
import { hashOutputs } from "@/lib/metrics/registry/hash";
import { POLICY_DEFINITIONS_VERSION } from "@/lib/policyEngine/version";
import { computeSnapshotHash } from "./hashSnapshot";
import { extractBaseValues } from "./extractBaseValues";
import type { FinancialModel, RiskFlag } from "./types";
import type { SpreadViewModel } from "./renderer/types";
import type { FinancialFact, RenderedSpread } from "@/lib/financialSpreads/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthoritativeResult {
  /** The built financial model from canonical facts */
  financialModel: FinancialModel;
  /** Computed metrics from the metric graph */
  computedMetrics: Record<string, number | null>;
  /** Risk flags from risk evaluation */
  riskFlags: RiskFlag[];
  /** Renderer-neutral view model (V2 authoritative output) */
  viewModel: SpreadViewModel;
  /** Persisted snapshot ID (null if persist failed — non-fatal) */
  snapshotId: string | null;
  /** Canonical facts used */
  facts: FinancialFact[];
  /** Validation result from snapshot (may be null) */
  validation: any | null;
}

export interface LegacyResult {
  /** V1 rendered spread */
  renderedSpread: RenderedSpread;
  /** Validation from V1 pipeline */
  validation: any | null;
}

// ---------------------------------------------------------------------------
// Authoritative Engine (V2)
// ---------------------------------------------------------------------------

/**
 * Compute the authoritative financial model for a deal.
 *
 * This is the single path that may persist snapshots and write to deal_spreads.
 * Encapsulates: facts → model → metrics → viewModel → persist.
 */
export async function computeAuthoritativeEngine(
  dealId: string,
  bankId: string,
): Promise<AuthoritativeResult> {
  const sb = supabaseAdmin();

  // 1. Load canonical facts
  const { data: rawFacts, error: factsErr } = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .neq("fact_type", "EXTRACTION_HEARTBEAT");

  if (factsErr) {
    throw new Error(`facts_load_failed: ${factsErr.message}`);
  }

  const facts = (rawFacts ?? []) as FinancialFact[];

  // 2. Build financial model
  const financialModel = buildFinancialModel(dealId, facts);

  // 3. Evaluate metric graph (audit mode — captures dependency graph)
  const metricDefs = await loadMetricRegistry(sb, "v1");
  const baseValues = extractBaseValues(financialModel);
  const auditResult = evaluateMetricGraphWithAudit(metricDefs, baseValues);
  const computedMetrics = auditResult.values;
  const dependencyGraph = auditResult.dependencyGraph;

  // 3b. Resolve registry + policy bindings (non-fatal, bank-aware)
  const registryBinding = await resolveRegistryBinding(sb, bankId).catch(() => null);
  const registryVersion = registryBinding?.registryVersionName ?? "unbound";
  const policyVersion = POLICY_DEFINITIONS_VERSION;

  // 3c. Compute hashes
  const outputsHash = hashOutputs({ computedMetrics });
  const snapshotHash = computeSnapshotHash({
    facts: facts.map(f => ({
      fact_type: f.fact_type, fact_key: f.fact_key,
      fact_value_num: f.fact_value_num, fact_period_end: f.fact_period_end,
    })),
    financialModel,
    metrics: computedMetrics,
    registry_version: registryVersion,
    policy_version: policyVersion,
  });

  // 4. Risk evaluation
  const { evaluateRisk } = await import("./riskEngine");
  const riskResult = evaluateRisk(computedMetrics);

  // 5. Render view model
  const viewModel = renderFromFinancialModel(financialModel, dealId);

  // 6. Persist snapshot (authoritative — only this function may do this)
  let snapshotId: string | null = null;
  try {
    const persistResult = await persistModelV2SnapshotFromDeal({
      dealId,
      bankId,
      model: financialModel,
      engineSource: "authoritative",
    });
    snapshotId = persistResult?.snapshotId ?? null;
  } catch {
    // Non-fatal — snapshot persist failure does not block response
  }

  // 7. Persist rendered output to deal_spreads (authoritative — envelope format)
  const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
  void (sb as any)
    .from("deal_spreads")
    .upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        spread_type: "STANDARD",
        spread_version: 1,
        owner_type: "DEAL",
        owner_entity_id: SENTINEL_UUID,
        status: "ready",
        inputs_hash: null,
        rendered_json: {
          engine: "v2_authoritative",
          schema_version: 2,
          registry_version: registryVersion,
          policy_version: policyVersion,
          snapshot_hash: snapshotHash,
          outputs_hash: outputsHash,
          explainability: { dependencyGraph },
          payload: viewModel,
        },
        rendered_html: null,
        rendered_csv: null,
        error: null,
        error_code: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" },
    )
    .then(() => {})
    .catch((err: any) => {
      console.warn("[engineAuthority] deal_spreads persist failed (non-fatal)", err?.message);
    });

  // 8. Emit authoritative served event
  emitV2Event({
    code: V2_EVENT_CODES.MODEL_V2_PRIMARY_SERVED,
    dealId,
    bankId,
    payload: {
      surface: "authoritative_engine",
      sectionCount: viewModel.sections.length,
      periodCount: financialModel.periods.length,
      metricsComputed: Object.keys(computedMetrics).length,
    },
  });

  return {
    financialModel,
    computedMetrics,
    riskFlags: riskResult.flags,
    viewModel,
    snapshotId,
    facts,
    validation: null,
  };
}

// ---------------------------------------------------------------------------
// Legacy Comparison (V1) — Read-Only
// ---------------------------------------------------------------------------

/**
 * Compute V1 legacy rendering for comparison purposes only.
 *
 * NO persistence. NO side effects. Returns null if shadow compare is disabled.
 * Only called when SHADOW_COMPARE=true for diff telemetry.
 */
export async function computeLegacyComparison(
  dealId: string,
  bankId: string,
  facts?: FinancialFact[],
): Promise<LegacyResult | null> {
  if (!isShadowCompareEnabled()) {
    return null;
  }

  const sb = supabaseAdmin();

  // Load facts if not provided
  let factsToUse = facts;
  if (!factsToUse) {
    const { data: rawFacts } = await (sb as any)
      .from("deal_financial_facts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT");
    factsToUse = (rawFacts ?? []) as FinancialFact[];
  }

  // Build snapshot for validation (non-fatal)
  let snapshot = null;
  try {
    snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
  } catch {
    // Non-fatal
  }

  // Render V1 (read-only — no persistence)
  const result = renderStandardSpreadWithValidation({
    dealId,
    bankId,
    facts: factsToUse,
    snapshot,
  });
  const { validation, ...renderedSpread } = result;

  return {
    renderedSpread,
    validation: validation ?? null,
  };
}
