/**
 * Phase 12 — Deterministic Replay Endpoint
 *
 * GET /api/deals/[dealId]/model-v2/replay
 *
 * Recomputes the financial model from current facts and compares the
 * resulting snapshot_hash to the stored envelope hash.
 *
 * Version guards:
 *   - schema_version < 2 → 409 MODEL_SNAPSHOT_LEGACY_VERSION
 *   - registry version mismatch → 409 MODEL_REGISTRY_VERSION_MISMATCH
 *   - policy version mismatch → 409 MODEL_POLICY_VERSION_MISMATCH
 */

import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildFinancialModel } from "@/lib/modelEngine/buildFinancialModel";
import { extractBaseValues } from "@/lib/modelEngine/extractBaseValues";
import { evaluateMetricGraphWithAudit } from "@/lib/modelEngine/metricGraph";
import { loadMetricRegistry } from "@/lib/modelEngine/metricRegistryLoader";
import { computeSnapshotHash } from "@/lib/modelEngine/hashSnapshot";
import { resolveRegistryBinding } from "@/lib/metrics/registry/selectActiveVersion";
import { POLICY_DEFINITIONS_VERSION } from "@/lib/policyEngine/version";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
import type { FinancialFact } from "@/lib/financialSpreads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "unauthorized" ? 401
      : access.error === "tenant_mismatch" ? 403 : 404;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  const { bankId } = access;
  const sb = supabaseAdmin();

  // 1. Load stored envelope from deal_spreads
  const { data: spread } = await (sb as any)
    .from("deal_spreads")
    .select("rendered_json")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("spread_type", "STANDARD")
    .eq("spread_version", 1)
    .eq("owner_type", "DEAL")
    .eq("owner_entity_id", "00000000-0000-0000-0000-000000000000")
    .maybeSingle();

  if (!spread?.rendered_json) {
    return NextResponse.json(
      { ok: false, error: "no_envelope", detail: "No deal_spreads envelope found" },
      { status: 404 },
    );
  }

  const envelope = spread.rendered_json as Record<string, unknown>;

  // 2. Schema version guard
  if (!envelope.schema_version || (envelope.schema_version as number) < 2) {
    return NextResponse.json(
      { ok: false, error: "MODEL_SNAPSHOT_LEGACY_VERSION", detail: `schema_version=${envelope.schema_version ?? "missing"}` },
      { status: 409 },
    );
  }

  // 3. Version guards (bank-aware binding)
  const liveBinding = await resolveRegistryBinding(sb, bankId);
  const liveRegistryVersion = liveBinding?.registryVersionName ?? "unbound";

  if (envelope.registry_version !== liveRegistryVersion) {
    return NextResponse.json(
      {
        ok: false,
        error: "MODEL_REGISTRY_VERSION_MISMATCH",
        stored: envelope.registry_version,
        live: liveRegistryVersion,
      },
      { status: 409 },
    );
  }

  if (envelope.policy_version !== POLICY_DEFINITIONS_VERSION) {
    return NextResponse.json(
      {
        ok: false,
        error: "MODEL_POLICY_VERSION_MISMATCH",
        stored: envelope.policy_version,
        live: POLICY_DEFINITIONS_VERSION,
      },
      { status: 409 },
    );
  }

  // 4. Load facts + replay computation
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

  // 5. Replay: build model → evaluate metrics → compute hash
  const financialModel = buildFinancialModel(dealId, facts);

  const metricDefs = await loadMetricRegistry(sb, "v1");
  const baseValues = extractBaseValues(financialModel);

  const auditResult = evaluateMetricGraphWithAudit(metricDefs, baseValues);

  const replayHash = computeSnapshotHash({
    facts: facts.map(f => ({
      fact_type: f.fact_type, fact_key: f.fact_key,
      fact_value_num: f.fact_value_num, fact_period_end: f.fact_period_end,
    })),
    financialModel,
    metrics: auditResult.values,
    registry_version: liveRegistryVersion,
    policy_version: POLICY_DEFINITIONS_VERSION,
  });

  // 6. Compare
  const storedHash = envelope.snapshot_hash as string;
  const hashMatch = replayHash === storedHash;

  // 7. Emit telemetry
  emitV2Event({
    code: hashMatch
      ? V2_EVENT_CODES.METRIC_REGISTRY_REPLAY_MATCH
      : V2_EVENT_CODES.METRIC_REGISTRY_REPLAY_MISMATCH,
    dealId,
    bankId,
    payload: { storedHash, replayHash, registryVersion: liveRegistryVersion },
  });

  return NextResponse.json({
    ok: true,
    hashMatch,
    storedHash,
    replayHash,
    registryVersion: liveRegistryVersion,
    policyVersion: POLICY_DEFINITIONS_VERSION,
    replayedAt: new Date().toISOString(),
  });
}
