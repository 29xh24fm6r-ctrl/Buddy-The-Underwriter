/**
 * POST /api/deals/[dealId]/intake/process
 *
 * Dedicated durable execution container for confirmed intake processing.
 * Decoupled from the confirm route so processing survives Lambda termination.
 *
 * Auth: BOTH x-buddy-internal header AND valid worker/cron secret required.
 * maxDuration = 300 (5 minutes) — Vercel allocates a full Lambda timeout.
 *
 * Implements a soft deadline guard (SOFT_DEADLINE_MS, 4 minutes): if processing
 * hasn't completed by then, we force-transition the deal to
 * PROCESSING_COMPLETE_WITH_ERRORS before the Lambda is killed, guaranteeing
 * a terminal phase.
 */

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { enqueueDealProcessing } from "@/lib/intake/processing/enqueueDealProcessing";
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { hasValidWorkerSecret } from "@/lib/auth/hasValidWorkerSecret";
import {
  PROCESSING_OBSERVABILITY_VERSION,
  SOFT_DEADLINE_MS,
} from "@/lib/intake/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — durable processing window

function isAuthorized(req: NextRequest): boolean {
  // Both internal marker AND valid worker/cron secret required.
  // x-buddy-internal alone is not sufficient — prevents browser access.
  const isInternal = req.headers.get("x-buddy-internal") === "1";
  if (!isInternal) return false;
  return hasValidWorkerSecret(req);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: { dealId?: string; bankId?: string; runId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const { dealId, bankId, runId } = body;
  if (!dealId || !bankId || !runId) {
    return NextResponse.json(
      { ok: false, error: "missing_dealId_bankId_or_runId" },
      { status: 400 },
    );
  }

  const startMs = Date.now();

  // Emit start event — no silent paths
  await writeEvent({
    dealId,
    kind: "intake.processing_start",
    scope: "intake",
    meta: {
      run_id: runId,
      bank_id: bankId,
      observability_version: PROCESSING_OBSERVABILITY_VERSION,
    },
  });

  try {
    // Race processing against soft deadline to guarantee phase transition.
    // If processing takes longer than SOFT_DEADLINE_MS, the deadline path
    // transitions the deal to error state and throws, hitting the catch block.
    const result = await Promise.race([
      enqueueDealProcessing(dealId, bankId, runId),
      (async () => {
        await new Promise((r) => setTimeout(r, SOFT_DEADLINE_MS));

        // Fail-closed: guarantee terminal transition if still owner
        await writeEvent({
          dealId,
          kind: "intake.processing_soft_deadline_hit",
          scope: "intake",
          meta: {
            run_id: runId,
            elapsed_ms: Date.now() - startMs,
            soft_deadline_ms: SOFT_DEADLINE_MS,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        await updateDealIfRunOwner(dealId, runId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `soft_deadline: processing exceeded ${SOFT_DEADLINE_MS}ms`,
        });

        throw new Error("SOFT_DEADLINE_EXCEEDED");
      })(),
    ]);

    // Emit completion event
    await writeEvent({
      dealId,
      kind: "intake.processing_route_complete",
      scope: "intake",
      meta: {
        run_id: runId,
        elapsed_ms: Date.now() - startMs,
        ok: result.ok,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    const elapsed = Date.now() - startMs;
    const isSoftDeadline = err?.message === "SOFT_DEADLINE_EXCEEDED";

    console.error("[intake/process] processing failed", {
      dealId,
      runId,
      error: err?.message,
      elapsed,
      soft_deadline: isSoftDeadline,
    });

    // Guarantee terminal phase transition (soft deadline already transitioned above)
    if (!isSoftDeadline) {
      try {
        await updateDealIfRunOwner(dealId, runId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `process_route: ${err?.message?.slice(0, 200)}`,
        });
      } catch (transitionErr: any) {
        console.error("[intake/process] failed to transition phase", {
          dealId,
          runId,
          error: transitionErr?.message,
        });
      }

      await writeEvent({
        dealId,
        kind: "intake.processing_route_error",
        scope: "intake",
        meta: {
          run_id: runId,
          elapsed_ms: elapsed,
          error: err?.message?.slice(0, 200),
          observability_version: PROCESSING_OBSERVABILITY_VERSION,
        },
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: isSoftDeadline ? "soft_deadline_exceeded" : err?.message,
        elapsed,
      },
      { status: isSoftDeadline ? 504 : 500 },
    );
  }
}
