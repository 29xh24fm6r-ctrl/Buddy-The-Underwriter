import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { ALL_STEPS } from "@/lib/orchestration/autoUnderwriteTypes";
import type { AutoUnderwriteStatus, AutoUnderwriteStep, AutoUnderwriteStepStatus } from "@/lib/orchestration/autoUnderwriteTypes";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/auto-underwrite/status
 * Derives orchestration state exclusively from deal_pipeline_ledger.
 * Does NOT query deals, deal_document_items, or credit_memo tables.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const sb = supabaseAdmin();

    // Read all auto_underwrite events for this deal
    const { data: events } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, status, payload, created_at, meta")
      .eq("deal_id", dealId)
      .like("event_key", "auto_underwrite.%")
      .order("created_at", { ascending: true });

    if (!events || events.length === 0) {
      return NextResponse.json({
        ok: true,
        ...idleStatus(dealId),
      });
    }

    // Derive step statuses from events
    const stepMap = new Map<string, {
      status: AutoUnderwriteStepStatus;
      durationMs?: number;
      error?: string;
      startedAt?: string;
      completedAt?: string;
    }>();

    let overallStartedAt: string | null = null;
    let overallCompletedAt: string | null = null;
    let overallStatus: AutoUnderwriteStatus["status"] = "idle";
    let currentStep: AutoUnderwriteStep | null = null;
    let memoReady = false;
    let voiceSummaryReady = false;

    for (const evt of events) {
      const key = evt.event_key as string;
      const payload = (evt.payload ?? {}) as Record<string, unknown>;

      if (key === "auto_underwrite.started") {
        overallStartedAt = evt.created_at;
        overallStatus = "running";
        continue;
      }
      if (key === "auto_underwrite.complete") {
        overallCompletedAt = evt.created_at;
        overallStatus = "complete";
        memoReady = payload.memo_ready === true;
        voiceSummaryReady = payload.voice_summary_ready === true;
        continue;
      }
      if (key === "auto_underwrite.failed") {
        overallCompletedAt = evt.created_at;
        overallStatus = "failed";
        continue;
      }

      // Parse step events: auto_underwrite.{step}.{started|complete|failed}
      const match = key.match(/^auto_underwrite\.(.+)\.(started|complete|failed)$/);
      if (!match) continue;

      const step = match[1] as AutoUnderwriteStep;
      const action = match[2];

      if (action === "started") {
        stepMap.set(step, { status: "running", startedAt: evt.created_at });
        currentStep = step;
      } else if (action === "complete") {
        const existing = stepMap.get(step) ?? {};
        stepMap.set(step, {
          ...existing,
          status: "complete",
          completedAt: evt.created_at,
          durationMs: typeof payload.duration_ms === "number" ? payload.duration_ms : undefined,
        });
        if (step === "credit_memo") memoReady = true;
        if (step === "voice_summary") voiceSummaryReady = true;
      } else if (action === "failed") {
        const existing = stepMap.get(step) ?? {};
        stepMap.set(step, {
          ...existing,
          status: "failed",
          completedAt: evt.created_at,
          error: typeof payload.error === "string" ? payload.error : undefined,
          durationMs: typeof payload.duration_ms === "number" ? payload.duration_ms : undefined,
        });
      }
    }

    // Build step array
    const steps = ALL_STEPS.map((step) => {
      const info = stepMap.get(step);
      return {
        step,
        status: (info?.status ?? "pending") as AutoUnderwriteStepStatus,
        durationMs: info?.durationMs,
        error: info?.error,
        startedAt: info?.startedAt,
        completedAt: info?.completedAt,
      };
    });

    // Find current step (last running)
    if (overallStatus === "running") {
      const runningStep = [...steps].reverse().find((s) => s.status === "running");
      currentStep = runningStep?.step ?? currentStep;
    } else {
      currentStep = null;
    }

    return NextResponse.json({
      ok: true,
      dealId,
      status: overallStatus,
      currentStep,
      steps,
      startedAt: overallStartedAt,
      completedAt: overallCompletedAt,
      memoReady,
      voiceSummaryReady,
    } satisfies { ok: true } & AutoUnderwriteStatus);
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

function idleStatus(dealId: string): AutoUnderwriteStatus {
  return {
    dealId,
    status: "idle",
    currentStep: null,
    steps: ALL_STEPS.map((step) => ({ step, status: "pending" })),
    startedAt: null,
    completedAt: null,
    memoReady: false,
    voiceSummaryReady: false,
  };
}
