import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { renderMoodysSpreadWithValidation } from "@/lib/financialSpreads/moodys/renderMoodysSpread";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { buildFinancialModel } from "@/lib/modelEngine";
import { runFullUnderwrite } from "@/lib/underwritingEngine";
import { loadDealModel } from "@/lib/underwritingEngine/loaders/loadDealModel";
import { loadDealInstruments } from "@/lib/underwritingEngine/loaders/loadDealInstruments";
import { loadActiveBankConfig } from "@/lib/configEngine";
import { emitV2Event, V2_EVENT_CODES } from "@/lib/modelEngine/events";
import { loadVersionById, loadVersionEntries } from "@/lib/metrics/registry/selectActiveVersion";
import { hashRegistry, hashOutputs } from "@/lib/metrics/registry/hash";
import type { FinancialFact } from "@/lib/financialSpreads/types";
import type { ProductType } from "@/lib/creditLenses/types";
import type { UnderwriteResult } from "@/lib/underwritingEngine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// Product type resolution (same as underwrite/route.ts)
// ---------------------------------------------------------------------------

const PRODUCT_TYPE_MAP: Record<string, ProductType> = {
  SBA: "SBA",
  "SBA 7(a)": "SBA",
  "SBA 504": "SBA",
  LOC: "LOC",
  "LINE OF CREDIT": "LOC",
  EQUIPMENT: "EQUIPMENT",
  ACQUISITION: "ACQUISITION",
  CRE: "CRE",
  "COMMERCIAL REAL ESTATE": "CRE",
  CONVENTIONAL: "CRE",
};

async function resolveProductType(dealId: string): Promise<ProductType> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deal_loan_requests")
    .select("product_type")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = (data?.product_type ?? "SBA").toUpperCase();
  return PRODUCT_TYPE_MAP[raw] ?? "SBA";
}

// ---------------------------------------------------------------------------
// GET /api/admin/deals/[dealId]/underwrite/replay
//
// Admin-only replay endpoint. Reruns V1 or V2 underwriting from current facts.
// This is the ONLY allowed V1 execution path when V1_RENDERER_DISABLED=true.
//
// Query params:
//   ?engine=v1|v2 (default: v2)
//   ?snapshot_id=<uuid> (optional: load existing snapshot for comparison)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    await requireSuperAdmin();

    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    // Look up deal + bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    const bankId = deal.bank_id as string;

    // Parse query params
    const url = new URL(req.url);
    const engine = url.searchParams.get("engine") ?? "v2";
    const snapshotId = url.searchParams.get("snapshot_id");

    if (engine !== "v1" && engine !== "v2") {
      return NextResponse.json(
        { ok: false, error: "invalid_engine", message: "engine must be v1 or v2" },
        { status: 400 },
      );
    }

    // Check V1 audit replay is enabled
    if (engine === "v1" && process.env.V1_AUDIT_REPLAY_ENABLED === "false") {
      return NextResponse.json(
        { ok: false, error: "v1_audit_replay_disabled" },
        { status: 403 },
      );
    }

    // Load facts (used by both engines)
    const { data: rawFacts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT");

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    const facts = (rawFacts ?? []) as FinancialFact[];

    // Optionally load existing snapshot for comparison
    let existingSnapshot: Record<string, unknown> | null = null;
    if (snapshotId) {
      const { data: snap } = await sb
        .from("deal_model_snapshots")
        .select("*")
        .eq("id", snapshotId)
        .eq("deal_id", dealId)
        .maybeSingle();
      existingSnapshot = snap;
    }

    const traceId = crypto.randomUUID();
    const replayedAt = new Date().toISOString();

    // -----------------------------------------------------------------------
    // V1 Replay
    // -----------------------------------------------------------------------
    if (engine === "v1") {
      let snapshot = null;
      try {
        snapshot = await buildDealFinancialSnapshotForBank({ dealId, bankId });
      } catch {
        // Non-fatal
      }

      const { validation, ...rendered } = renderMoodysSpreadWithValidation({
        dealId,
        bankId,
        facts,
        snapshot,
      });

      emitV2Event({
        code: V2_EVENT_CODES.MODEL_V1_AUDIT_REPLAY_SERVED,
        dealId,
        bankId,
        payload: { traceId, factCount: facts.length },
      });

      return NextResponse.json({
        ok: true,
        engine: "v1",
        dealId,
        traceId,
        replayedAt,
        outputs: {
          spread: rendered,
          validation: validation ?? null,
          snapshot: snapshot ?? null,
        },
        factCount: facts.length,
        ...(existingSnapshot ? { existingSnapshot } : {}),
      });
    }

    // -----------------------------------------------------------------------
    // V2 Replay
    // -----------------------------------------------------------------------

    // Phase 12: Registry hash verification (when replaying a snapshot)
    let registryVerification: {
      status: "match" | "mismatch" | "no_binding" | "version_missing";
      snapshotHash?: string;
      currentHash?: string;
      registryVersionId?: string;
    } | undefined;

    if (existingSnapshot) {
      const snapRegVersionId = (existingSnapshot as any).registry_version_id;
      const snapRegHash = (existingSnapshot as any).registry_content_hash;

      if (snapRegVersionId && snapRegHash) {
        const regVersion = await loadVersionById(sb, snapRegVersionId);
        if (!regVersion) {
          registryVerification = { status: "version_missing", registryVersionId: snapRegVersionId };
        } else {
          // Load entries and compute current hash
          const entries = await loadVersionEntries(sb, snapRegVersionId);
          const currentHash = hashRegistry(
            entries.map((e) => ({ metric_key: e.metricKey, definition_json: e.definitionJson })),
          );

          if (currentHash !== snapRegHash) {
            registryVerification = {
              status: "mismatch",
              snapshotHash: snapRegHash,
              currentHash,
              registryVersionId: snapRegVersionId,
            };

            emitV2Event({
              code: V2_EVENT_CODES.METRIC_REGISTRY_HASH_MISMATCH,
              dealId,
              bankId,
              payload: {
                traceId,
                snapshotId,
                registryVersionId: snapRegVersionId,
                snapshotHash: snapRegHash,
                currentHash,
              },
            });

            return NextResponse.json(
              {
                ok: false,
                engine: "v2",
                error: "REGISTRY_HASH_MISMATCH",
                traceId,
                registryVerification,
              },
              { status: 409 },
            );
          }

          registryVerification = {
            status: "match",
            snapshotHash: snapRegHash,
            currentHash,
            registryVersionId: snapRegVersionId,
          };
        }
      } else {
        registryVerification = { status: "no_binding" };
      }
    }

    const [model, instruments, bankConfig, product] = await Promise.all([
      loadDealModel(dealId),
      loadDealInstruments(dealId),
      loadActiveBankConfig(bankId),
      resolveProductType(dealId),
    ]);

    const result = runFullUnderwrite({
      model,
      product,
      instruments: instruments.length > 0 ? instruments : undefined,
      bankConfig: bankConfig ?? undefined,
    });

    if (!result.diagnostics.pipelineComplete) {
      return NextResponse.json(
        {
          ok: false,
          engine: "v2",
          error: "v2_pipeline_incomplete",
          reason: (result as { diagnostics: { reason: string } }).diagnostics.reason,
          traceId,
        },
        { status: 500 },
      );
    }

    const v2Result = result as UnderwriteResult;

    // Phase 12: compute outputs hash + compare with snapshot
    const outputs = {
      snapshot: v2Result.snapshot,
      analysis: v2Result.analysis,
      policy: v2Result.policy,
      stress: v2Result.stress,
      pricing: v2Result.pricing,
      memo: v2Result.memo,
    };
    const replayOutputsHash = hashOutputs(outputs);

    let outputsVerification: {
      status: "match" | "mismatch" | "no_stored_hash";
      replayHash: string;
      storedHash?: string;
    } | undefined;

    if (existingSnapshot) {
      const storedOutputsHash = (existingSnapshot as any).outputs_hash;
      if (storedOutputsHash) {
        const isMatch = replayOutputsHash === storedOutputsHash;
        outputsVerification = {
          status: isMatch ? "match" : "mismatch",
          replayHash: replayOutputsHash,
          storedHash: storedOutputsHash,
        };

        emitV2Event({
          code: isMatch
            ? V2_EVENT_CODES.METRIC_REGISTRY_REPLAY_MATCH
            : V2_EVENT_CODES.METRIC_REGISTRY_REPLAY_MISMATCH,
          dealId,
          bankId,
          payload: { traceId, snapshotId, replayHash: replayOutputsHash, storedHash: storedOutputsHash },
        });
      } else {
        outputsVerification = { status: "no_stored_hash", replayHash: replayOutputsHash };
      }
    }

    emitV2Event({
      code: V2_EVENT_CODES.MODEL_V2_AUDIT_REPLAY_SERVED,
      dealId,
      bankId,
      payload: {
        traceId,
        tier: v2Result.policy.tier,
        periodCount: model.periods.length,
        instrumentCount: instruments.length,
      },
    });

    return NextResponse.json({
      ok: true,
      engine: "v2",
      dealId,
      traceId,
      replayedAt,
      outputs,
      outputsHash: replayOutputsHash,
      diagnostics: {
        modelPeriodCount: model.periods.length,
        instrumentCount: instruments.length,
        pipelineComplete: result.diagnostics.pipelineComplete,
      },
      ...(registryVerification ? { registryVerification } : {}),
      ...(outputsVerification ? { outputsVerification } : {}),
      ...(existingSnapshot ? { existingSnapshot } : {}),
    });
  } catch (e: any) {
    console.error("[/api/admin/deals/[dealId]/underwrite/replay]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
